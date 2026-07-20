// Anthropic-type provider adapter (ADR 0007 / HANDOFF.md §5). Wraps the Anthropic SDK;
// accepts a custom baseURL so the "local" provider entry in the sample config can point at
// any Anthropic-compatible endpoint using this same adapter.

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "../../contracts/index.ts";
import { withRetry } from "./retry.ts";
import {
  type ErrorClassification,
  isContextOverflowMessage,
  mapStopReason,
  withCacheMarkers,
} from "./shared.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderStopReason,
  ProviderStreamCallbacks,
} from "./types.ts";
import { ProviderError } from "./types.ts";

const DEFAULT_MAX_TOKENS = 8192;

/** Minimal slice of the Anthropic SDK client this adapter depends on — lets tests inject a
 * fake without touching the network.
 *
 * DH-0044: `create()` now always requests `stream: true` and returns an async iterable of
 * `Anthropic.RawMessageStreamEvent` — the SDK's *raw* streaming shape, not the `messages.
 * stream()` helper (`MessageStream`). The raw iterable keeps this a minimal injectable slice
 * (tests inject a plain fake async-iterable, no `MessageStream` class to fake) and the
 * accumulation logic below is small and explicit, which the 100%-coverage gate wants anyway. */
export interface AnthropicClientLike {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
  };
}

function toAnthropicContent(block: ProviderContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError !== undefined ? { is_error: block.isError } : {}),
      };
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: block.data };
  }
}

/** DH-0045 §3: builds the Anthropic `thinking` request param from `ModelConfig.thinking`. */
function toAnthropicThinkingParam(
  thinking: NonNullable<ProviderCompletionRequest["thinking"]>,
): Anthropic.ThinkingConfigParam {
  if (thinking.type === "adaptive") {
    return {
      type: "adaptive",
      ...(thinking.display !== undefined ? { display: thinking.display } : {}),
    };
  }
  return {
    type: "enabled",
    budget_tokens: thinking.budgetTokens as number,
    ...(thinking.display !== undefined ? { display: thinking.display } : {}),
  };
}

/** DH-0045 §3: for `type: "enabled"`, the API requires `budget_tokens < max_tokens` — the
 * thinking budget never cannibalizes the response budget, deterministically and without a
 * new config knob. Adaptive form: no change to max_tokens handling. */
function resolveMaxTokens(request: ProviderCompletionRequest): number {
  const base = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (request.thinking?.type === "enabled" && request.thinking.budgetTokens !== undefined) {
    return Math.max(base, request.thinking.budgetTokens + DEFAULT_MAX_TOKENS);
  }
  return base;
}

/** DH-0010 Part A: mutates a copy of `messages` (never the original — the caller's own
 * `messages` array in loop.ts must survive unchanged across turns) to add `cache_control:
 * { type: "ephemeral" }` to the last content block of the final message, and (if one
 * exists) the last content block of the second-to-last *user* message — the two message-side
 * breakpoints per tracking/DH-0010's Design section. The system+tools breakpoint is applied
 * separately at the request-building call site. Only called when `request.cache` is true;
 * when false the request is built with zero marker fields, byte-identical to pre-DH-0010
 * behavior. */
interface CacheableMessage {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
}

function withAnthropicCacheMarkers(messages: CacheableMessage[]): CacheableMessage[] {
  return withCacheMarkers(messages, (content) => {
    if (content.length === 0) return content;
    const lastIndex = content.length - 1;
    const block = content[lastIndex];
    const next = [...content];
    next[lastIndex] = {
      ...block,
      cache_control: { type: "ephemeral" },
    } as Anthropic.ContentBlockParam;
    return next;
  });
}

/** DH-0009: classifies a raw thrown value from the Anthropic SDK. The SDK's own `APIError`
 * (and subclasses like `AuthenticationError`/`RateLimitError`/`InternalServerError`) carry a
 * `status` HTTP code. Without one, two genuinely different situations are both possible —
 * distinguished by the SDK's own error class, not just "no status means network":
 * `Anthropic.APIConnectionError` means the request never reached the provider at all (DNS,
 * connection refused, TLS) — retryable. Anything else with no status (e.g. a plain
 * `SyntaxError` from `JSON.parse` when the provider responds 200 with a garbled/non-JSON
 * body) got a response, just an unusable one — retrying the same malformed endpoint is
 * unlikely to help, so this is `other`/not retryable rather than optimistically `network`. */
// DH-0010 Part B: best-effort detection of "the request was rejected for being too long" —
// string/shape-matching on the Anthropic 400 `invalid_request_error` message, since the SDK
// has no dedicated error subclass for this. Accepted as a known-fragile heuristic (see
// tracking/DH-0010's Risks section) — a miss here just falls through to the normal `other`
// (non-retryable) classification, not a crash.
const CONTEXT_OVERFLOW_MESSAGE_PATTERN = /prompt is too long/i;

function classifyAnthropicError(err: unknown): ErrorClassification {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403) return { kind: "auth", retryable: false };
    if (status === 429) return { kind: "rate_limit", retryable: true };
    if (status >= 500) return { kind: "overloaded", retryable: true };
    if (
      status === 400 &&
      isContextOverflowMessage((err as Error).message ?? "", CONTEXT_OVERFLOW_MESSAGE_PATTERN)
    ) {
      return { kind: "context_overflow", retryable: false };
    }
    return { kind: "other", retryable: false };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: "network", retryable: true };
  }
  return { kind: "other", retryable: false };
}

export class AnthropicProvider implements ModelProvider {
  private client: AnthropicClientLike;
  private retryPolicy: ProviderConfig["retry"];

  constructor(config: ProviderConfig, client?: AnthropicClientLike) {
    this.client =
      client ??
      new Anthropic({
        apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
        baseURL: config.baseURL,
        // DH-0009: the SDK's own default retry behavior (maxRetries: 2, retrying 429/5xx
        // before ever rejecting) would otherwise compound with this adapter's own withRetry
        // below — each of *our* attempts silently becoming up to 3 real HTTP calls, a 3x (or
        // with our default maxAttempts: 3, up to 9x) multiplier on real network requests, not
        // the bounded retry policy an operator configured. This adapter now owns retry/backoff
        // exclusively; the SDK makes exactly one real attempt per call.
        maxRetries: 0,
        // dh is a CLI/server tool -- this client never actually runs inside a browser, so the
        // SDK's browser-credential-exposure guard is a false-positive risk here, not a real
        // one. Without this, the SDK's `typeof window !== "undefined"` heuristic throws
        // whenever another test file in the same bun test process has loaded happy-dom (used
        // for TUI/Web component tests) and left a global `window` behind -- cross-file global
        // leakage `--parallel=1` alone doesn't prevent, since it only serializes execution
        // order within one shared process, not per-file global state.
        dangerouslyAllowBrowser: true,
      });
    this.retryPolicy = config.retry;
  }

  async complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<ProviderCompletionResult> {
    // DH-0044 D6: retry only until the first delta actually reaches the caller — retrying a
    // request after partial text has already been streamed (and displayed live) would
    // duplicate that text on screen and in the durable log. `emittedAny` is shared across
    // every withRetry attempt via this closure.
    let emittedAny = false;
    let result: ProviderCompletionResult;
    try {
      result = await withRetry(
        async () => {
          const rawMessages: CacheableMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content.map(toAnthropicContent),
          }));
          const stream = await this.client.messages.create(
            {
              model: request.model,
              // DH-0010 Part A: system becomes the cache-control-annotated array form only
              // when `request.cache` is true — false/absent keeps the plain string, byte-
              // identical to pre-DH-0010 requests.
              system: request.cache
                ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
                : request.system,
              max_tokens: resolveMaxTokens(request),
              stream: true,
              messages: request.cache ? withAnthropicCacheMarkers(rawMessages) : rawMessages,
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
              ...(request.thinking !== undefined
                ? { thinking: toAnthropicThinkingParam(request.thinking) }
                : {}),
            },
            signal ? { signal } : undefined,
          );
          return consumeAnthropicStream(stream, callbacks, () => {
            emittedAny = true;
          });
        },
        (err) => !emittedAny && classifyAnthropicError(err).retryable,
        this.retryPolicy,
        signal,
      );
    } catch (err) {
      const { kind, retryable } = classifyAnthropicError(err);
      throw new ProviderError(`anthropic provider request failed: ${(err as Error).message}`, {
        cause: err,
        kind,
        retryable: retryable && !emittedAny,
      });
    }

    return result;
  }
}

/** DH-0044 D3: accumulates a raw Anthropic message stream into a complete
 * `ProviderCompletionResult`, invoking `callbacks.onTextDelta` for each text delta as it
 * arrives and `onFirstDelta` the first time any *text* delta is observed (used by the caller
 * to gate retry — see D6; a stream that only got as far as `message_start`/tool-input deltas
 * before failing is still safely retryable, since no visible text has reached the caller).
 * Block accumulation follows the SDK's documented event
 * order: `message_start` -> per block {`content_block_start`, `content_block_delta`*,
 * `content_block_stop`} -> `message_delta` -> `message_stop`. Unknown block/delta types are
 * skipped, matching the adapter's existing null-for-unknown-block behavior. */
async function consumeAnthropicStream(
  stream: AsyncIterable<Anthropic.RawMessageStreamEvent>,
  callbacks: ProviderStreamCallbacks | undefined,
  onFirstDelta: () => void,
): Promise<ProviderCompletionResult> {
  const blocks = new Map<number, { type: "text"; text: string } | ProviderContentBlock>();
  const toolJsonBuffers = new Map<number, string>();
  let inputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let outputTokens = 0;
  let stopReason: ProviderStopReason = "other";

  for await (const event of stream) {
    if (event.type === "message_start") {
      inputTokens = event.message.usage.input_tokens;
      if (event.message.usage.cache_read_input_tokens != null) {
        cacheReadTokens = event.message.usage.cache_read_input_tokens;
      }
      if (event.message.usage.cache_creation_input_tokens != null) {
        cacheWriteTokens = event.message.usage.cache_creation_input_tokens;
      }
      outputTokens = event.message.usage.output_tokens;
    } else if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "text") {
        blocks.set(event.index, { type: "text", text: "" });
      } else if (block.type === "tool_use") {
        blocks.set(event.index, { type: "tool_use", id: block.id, name: block.name, input: {} });
        toolJsonBuffers.set(event.index, "");
      } else if (block.type === "thinking") {
        // DH-0045: a non-empty `content_block_start` thinking block (rare, but the SDK type
        // allows it) seeds the accumulator with whatever text/signature already arrived;
        // usually both start empty and are filled in by thinking_delta/signature_delta below.
        blocks.set(event.index, {
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature,
        });
      } else if (block.type === "redacted_thinking") {
        // redacted_thinking arrives complete at block-start — there is no delta for it.
        blocks.set(event.index, { type: "redacted_thinking", data: block.data });
      }
      // Other unknown block types (server tools, etc.) get no accumulator — finalized as
      // null/skipped at content_block_stop — same treatment unknown blocks got in the
      // adapter's prior non-streaming implementation.
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        onFirstDelta();
        const existing = blocks.get(event.index);
        if (existing && existing.type === "text") {
          existing.text += event.delta.text;
        }
        callbacks?.onTextDelta?.(event.delta.text);
      } else if (event.delta.type === "input_json_delta") {
        const buffered = toolJsonBuffers.get(event.index);
        if (buffered !== undefined) {
          toolJsonBuffers.set(event.index, buffered + event.delta.partial_json);
        }
      } else if (event.delta.type === "thinking_delta") {
        const existing = blocks.get(event.index);
        if (existing && existing.type === "thinking") {
          existing.thinking += event.delta.thinking;
        }
      } else if (event.delta.type === "signature_delta") {
        const existing = blocks.get(event.index);
        if (existing && existing.type === "thinking") {
          existing.signature += event.delta.signature;
        }
      }
    } else if (event.type === "content_block_stop") {
      const buffered = toolJsonBuffers.get(event.index);
      if (buffered !== undefined) {
        const block = blocks.get(event.index);
        if (block && block.type === "tool_use") {
          block.input = buffered.length > 0 ? JSON.parse(buffered) : {};
        }
      }
    } else if (event.type === "message_delta") {
      if (event.delta.stop_reason !== null) {
        stopReason = mapStopReason(event.delta.stop_reason);
      }
      outputTokens = event.usage.output_tokens;
    }
    // message_stop carries no additional data — the loop just ends naturally after it.
  }

  const content = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) => block as ProviderContentBlock);

  return {
    stopReason,
    content,
    usage: {
      inputTokens,
      outputTokens,
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    },
  };
}
