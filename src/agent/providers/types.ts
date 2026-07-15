// Common internal provider interface — NOT part of src/contracts/ (that's cross-component
// wire truth; this is internal to how the agent loop talks to whichever SDK a given
// dh.json provider entry resolves to). Both the anthropic and bedrock adapters implement
// this so src/agent/loop.ts is provider-agnostic.

import type { JsonSchema } from "../tools/types.ts";

export type ProviderRole = "user" | "assistant";

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

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

export interface ModelProvider {
  /** `signal` (Round 3: docs/handoffs/core.md status log) is optional and best-effort — both
   * built-in adapters forward it straight to their SDK's own abort support so an in-flight
   * request can actually be cancelled, not just prevented from starting. A provider that
   * ignores it degrades gracefully to loop.ts's between-turn check only. */
  complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
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
 */
export type ProviderErrorKind = "auth" | "rate_limit" | "overloaded" | "network" | "other";

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
