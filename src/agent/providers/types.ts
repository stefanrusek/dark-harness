// Common internal provider interface — NOT part of src/contracts/ (that's cross-component
// wire truth; this is internal to how the agent loop talks to whichever SDK a given
// dh.json provider entry resolves to). Both the anthropic and bedrock adapters implement
// this so src/agent/loop.ts is provider-agnostic.

import type { ThinkingConfig } from "../../contracts/index.ts";
import type { JsonSchema } from "../tools/types.type.ts";

export type ProviderRole = "user" | "assistant";

/**
 * DH-0045: `thinking`/`redacted_thinking` mirror the Anthropic wire shape (verified against
 * the installed `@anthropic-ai/sdk` `ThinkingBlock`/`RedactedThinkingBlock` types).
 * `signature` is the model-issued verification token; it must be echoed back unmodified.
 * `data` is opaque base64 ciphertext — never decoded, never displayed, exists solely so
 * multi-turn echo works.
 */
export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContentBlock[];
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ProviderCompletionRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  maxTokens?: number;
  /** DH-0045: opt-in extended thinking, threaded from `ModelConfig.thinking`. Reuses the
   * contracts type directly (no separate camelCase internal mirror) — it's already
   * camelCase and provider-agnostic, so a second identical type would be pure duplication. */
  thinking?: ThinkingConfig;
  /** DH-0010 Part A: opt-in prompt caching, threaded from `ModelConfig.cache`. Absent/false
   * means requests stay byte-identical to pre-DH-0010 behavior (no cache marker fields at
   * all) — see anthropic.ts/bedrock.ts for the exact marker positions. */
  cache?: boolean;
}

export type ProviderStopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderCompletionResult {
  stopReason: ProviderStopReason;
  content: ProviderContentBlock[];
  usage: ProviderUsage;
}

/**
 * DH-0044: optional streaming side-channel `complete()`'s third param can accept. A callback
 * and not an async generator/return-type change — `loop.ts` needs the *complete* result at
 * the end of every turn regardless (the full content block array for `messages` history,
 * `usage` for `token_usage`, `stopReason` for the tool-use/self-report branch); with a
 * generator every consumer would have to re-implement content-block assembly (accumulate
 * text deltas, buffer tool_use JSON, map stop reason, collect usage) just to rebuild what
 * the adapter already knows. Keeping assembly inside the adapter (where the SDK-shape
 * knowledge lives) makes streaming a pure side-channel: `complete()`'s contract stays
 * identical (same return type, same error taxonomy, same retry wrapper), and a caller/
 * third-party adapter that ignores `callbacks` still works exactly as before this change.
 */
export interface ProviderStreamCallbacks {
  /** Called zero or more times, in order, with incremental assistant *text* as the provider
   * streams it. Advisory/display-only: the resolved ProviderCompletionResult remains the
   * single source of truth for content, stopReason, and usage. Tool-use input deltas are
   * never surfaced here (only text, per the design — DH-0044 D3/D4). A provider that ignores
   * this degrades gracefully to whole-turn output (loop.ts has a fallback — see loop.ts's
   * turn-completion handling). */
  onTextDelta?: (text: string) => void;
}

export interface ModelProvider {
  /** `signal` (Round 3: docs/handoffs/core.md status log) is optional and best-effort — both
   * built-in adapters forward it straight to their SDK's own abort support so an in-flight
   * request can actually be cancelled, not just prevented from starting. A provider that
   * ignores it degrades gracefully to loop.ts's between-turn check only.
   *
   * `callbacks` (DH-0044) is likewise optional and best-effort — see ProviderStreamCallbacks'
   * own doc comment. */
  complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<ProviderCompletionResult>;
}

/**
 * DH-0009 (tracking/DH-0009-provider-retry-backoff-and-error-taxonomy.md): classifies a
 * provider failure so downstream logic (retry, display) can react appropriately instead of
 * treating every SDK failure as one opaque, unclassified error.
 *
 * - `auth` — bad/missing credentials, forbidden. Never retryable — retrying sends the exact
 *   same doomed request again.
 * - `rate_limit` — 429/throttling. Retryable.
 * - `overloaded` — 5xx/server-side transient failure. Retryable.
 * - `network` — the request never reached the provider at all (DNS, connection refused, TLS).
 *   Retryable.
 * - `other` — anything not confidently classified as one of the above (e.g. a malformed
 *   request, a 4xx that isn't auth). Not retryable by default — an unrecognized error
 *   shouldn't be assumed safe to blindly retry.
 * - `context_overflow` — DH-0010 Part B: the request exceeded the model's context window
 *   (Anthropic 400 `invalid_request_error` "prompt is too long"; Bedrock `ValidationException`
 *   "Input is too long"). Never retryable — retrying the identical oversized request fails
 *   identically. `loop.ts` catches this kind specifically and reports a graceful agent
 *   failure instead of an uncaught crash.
 */
export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "other"
  | "context_overflow";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { cause?: unknown; kind?: ProviderErrorKind; retryable?: boolean },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.kind = options?.kind ?? "other";
    this.retryable = options?.retryable ?? false;
  }
}
