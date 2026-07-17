// A minimal Anthropic-compatible local HTTP server (docs/handoffs/e2e.md scope item 1).
// `src/agent/providers/anthropic.ts` (Core) talks to any `provider.type: "anthropic"` entry
// via `baseURL`, so pointing a `dh.json` "local" provider at this server's `.baseURL` makes
// the real `AnthropicProvider` adapter (unmodified) drive the whole e2e suite deterministically
// and for free — no real Anthropic API key or network egress involved.
//
// Only the one endpoint the SDK actually calls (`POST /v1/messages`, non-streaming) is
// implemented — that is all `AnthropicProvider.complete()` uses (see anthropic.ts's
// `client.messages.create(...)` call, `stream` is never set true).

import { randomUUID } from "node:crypto";

export interface MockToolCall {
  id?: string;
  name: string;
  input: unknown;
}

/** One scripted model turn. Shape mirrors just enough of `Anthropic.Message` for
 * `fromAnthropicContent`/`mapStopReason` (src/agent/providers/anthropic.ts) to round-trip it
 * back into a `ProviderCompletionResult` the agent loop understands. */
export interface MockTurn {
  text?: string;
  toolCalls?: MockToolCall[];
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
  inputTokens?: number;
  outputTokens?: number;
  /** Error-injection mode (DH-0033): when set, this scripted "turn" isn't a completion at
   * all — the server responds with this HTTP status/body instead of a `Message`, simulating
   * an upstream provider failure (429/500/etc) or a malformed response. Mutually exclusive
   * with the completion fields above. */
  error?: MockError;
  /** DH-0060 liveness/heartbeat spike support: delay this turn's HTTP response by this many
   * milliseconds before responding, simulating a long-running model call so a test can
   * observe the TUI's per-agent elapsed/liveness indicator actually advance mid-turn rather
   * than jumping straight from 0s to a completed reply. Ignored when `error` is set. */
  delayMs?: number;
}

export interface MockError {
  /** HTTP status to respond with, e.g. 429, 500, 529 (Anthropic's "overloaded"). */
  status: number;
  /** Response body, JSON-encoded. Defaults to a minimal Anthropic-shaped error envelope.
   * Ignored when `rawBody` is set. */
  body?: Record<string, unknown>;
  /** When set, respond with this literal string body instead of JSON-encoding `body` —
   * simulates a malformed/truncated/non-JSON upstream response (still whatever `status` is
   * set, default 200 for "malformed success body"). */
  rawBody?: string;
}

/** Shorthand for a scripted provider-error turn (DH-0033): the next `/v1/messages` call gets
 * this HTTP status/body instead of a completion — e.g. `errorTurn(429)` for a rate limit,
 * `errorTurn(529, { error: { type: "overloaded_error", message: "Overloaded" } })` for
 * Anthropic's overloaded response, `errorTurn(500)` for a generic upstream 5xx. */
export function errorTurn(status: number, body?: Record<string, unknown>): MockTurn {
  return { error: body !== undefined ? { status, body } : { status } };
}

/** Shorthand for a scripted malformed-response turn (DH-0033): a 200 whose body isn't valid
 * JSON at all — the "provider returned garbage" case, distinct from a clean non-200 error. */
export function malformedTurn(rawBody = "not json{{{"): MockTurn {
  return { error: { status: 200, rawBody } };
}

export interface MockAnthropicProvider {
  /** Pass as a `provider.baseURL` in a test's `dh.json` fixture. */
  baseURL: string;
  /** Every `/v1/messages` request body received so far, in order — lets a test assert on
   * what the real agent loop actually sent (system prompt, prior turns, tool defs, etc). */
  requests: Record<string, unknown>[];
  /** Number of `/v1/messages` calls served so far. */
  readonly callCount: number;
  stop(): void;
}

/** Builds a real Anthropic-shaped SSE streaming body (`message_start` /
 * `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` /
 * `message_stop`) from a scripted `MockTurn` — DH-0044 made `stream: true` mandatory on both
 * real provider adapters, so a single non-streaming JSON body (the pre-DH-0112 shape) is
 * never actually decoded by `AnthropicProvider.complete()`'s `consumeAnthropicStream`. Mirrors
 * the pattern already built in `src/agent/runtime.test.ts`'s `sseMessageResponse()` /
 * `src/agent/providers/anthropic.test.ts`'s `streamOf()` helpers. */
function turnToSseBody(turn: MockTurn): string {
  const inputTokens = turn.inputTokens ?? 10;
  const outputTokens = turn.outputTokens ?? 10;
  const stopReason =
    turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");

  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: "message_start",
      message: {
        id: `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        model: "mock-model",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    },
  ];

  let index = 0;
  if (turn.text !== undefined && turn.text.length > 0) {
    events.push({
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "", citations: null },
    });
    events.push({
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text: turn.text },
    });
    events.push({ type: "content_block_stop", index });
    index += 1;
  }
  for (const call of turn.toolCalls ?? []) {
    events.push({
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: call.id ?? `toolu_${randomUUID()}`,
        name: call.name,
        input: {},
      },
    });
    events.push({
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input ?? {}) },
    });
    events.push({ type: "content_block_stop", index });
    index += 1;
  }

  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  events.push({ type: "message_stop" });

  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/**
 * Starts the mock provider. `turns` is consumed in order, one per `/v1/messages` call; once
 * exhausted the last turn repeats (a safety net so a test that under-scripts doesn't hang the
 * agent loop indefinitely — it should still assert `callCount` to catch that).
 */
export function startMockAnthropicProvider(turns: MockTurn[]): MockAnthropicProvider {
  if (turns.length === 0) {
    throw new Error("startMockAnthropicProvider requires at least one scripted turn");
  }
  const requests: Record<string, unknown>[] = [];
  let callCount = 0;

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/messages" || req.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as Record<string, unknown>;
      requests.push(body);
      const index = Math.min(callCount, turns.length - 1);
      callCount += 1;
      // biome-ignore lint/style/noNonNullAssertion: index is clamped into [0, turns.length)
      const turn = turns[index]!;
      if (turn.error) {
        const { status, body: errBody, rawBody } = turn.error;
        if (rawBody !== undefined) {
          return new Response(rawBody, {
            status,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json(
          errBody ?? {
            type: "error",
            error: { type: "api_error", message: "mock provider error" },
          },
          { status },
        );
      }
      if (turn.delayMs !== undefined && turn.delayMs > 0) {
        await Bun.sleep(turn.delayMs);
      }
      return new Response(turnToSseBody(turn), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  return {
    baseURL: `http://localhost:${server.port}`,
    requests,
    get callCount() {
      return callCount;
    },
    stop: () => server.stop(true),
  };
}

/** Shorthand for the common case: one final plain-text completion, no tool calls. */
export function successTurn(text: string): MockTurn {
  return { text, stopReason: "end_turn" };
}

/** A self-reported-failure completion per loop.ts's `TASK_FAILED_MARKER` convention. */
export function taskFailedTurn(text = "Could not complete the task. TASK_FAILED"): MockTurn {
  return { text, stopReason: "end_turn" };
}
