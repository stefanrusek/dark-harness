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

function turnToMessage(turn: MockTurn) {
  const content: Record<string, unknown>[] = [];
  if (turn.text !== undefined && turn.text.length > 0) {
    content.push({ type: "text", text: turn.text });
  }
  for (const call of turn.toolCalls ?? []) {
    content.push({
      type: "tool_use",
      id: call.id ?? `toolu_${randomUUID()}`,
      name: call.name,
      input: call.input,
    });
  }
  const stopReason =
    turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: "mock-model",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: turn.inputTokens ?? 10,
      output_tokens: turn.outputTokens ?? 10,
    },
  };
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
      return Response.json(turnToMessage(turn));
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
