// Anthropic-type provider adapter (ADR 0007 / HANDOFF.md §5). Wraps the Anthropic SDK;
// accepts a custom baseURL so the "local" provider entry in the sample config can point at
// any Anthropic-compatible endpoint using this same adapter.

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "../../contracts/index.ts";
import { withRetry } from "./retry.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderErrorKind,
  ProviderStopReason,
} from "./types.ts";
import { ProviderError } from "./types.ts";

const DEFAULT_MAX_TOKENS = 8192;

/** Minimal slice of the Anthropic SDK client this adapter depends on — lets tests inject a
 * fake without touching the network. */
export interface AnthropicClientLike {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
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
  }
}

function fromAnthropicContent(block: Anthropic.ContentBlock): ProviderContentBlock | null {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "tool_use") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  }
  return null;
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): ProviderStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn") return "end_turn";
  return "other";
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
function classifyAnthropicError(err: unknown): { kind: ProviderErrorKind; retryable: boolean } {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403) return { kind: "auth", retryable: false };
    if (status === 429) return { kind: "rate_limit", retryable: true };
    if (status >= 500) return { kind: "overloaded", retryable: true };
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
      });
    this.retryPolicy = config.retry;
  }

  async complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    let response: Anthropic.Message;
    try {
      response = await withRetry(
        () =>
          this.client.messages.create(
            {
              model: request.model,
              system: request.system,
              max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
              messages: request.messages.map((m) => ({
                role: m.role,
                content: m.content.map(toAnthropicContent),
              })),
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            },
            signal ? { signal } : undefined,
          ),
        (err) => classifyAnthropicError(err).retryable,
        this.retryPolicy,
        signal,
      );
    } catch (err) {
      const { kind, retryable } = classifyAnthropicError(err);
      throw new ProviderError(`anthropic provider request failed: ${(err as Error).message}`, {
        cause: err,
        kind,
        retryable,
      });
    }

    const content = response.content
      .map(fromAnthropicContent)
      .filter((b): b is ProviderContentBlock => b !== null);

    return {
      stopReason: mapStopReason(response.stop_reason),
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ...(response.usage.cache_read_input_tokens != null
          ? { cacheReadTokens: response.usage.cache_read_input_tokens }
          : {}),
        ...(response.usage.cache_creation_input_tokens != null
          ? { cacheWriteTokens: response.usage.cache_creation_input_tokens }
          : {}),
      },
    };
  }
}
