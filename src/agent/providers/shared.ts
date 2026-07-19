// Shared helpers for the Anthropic-type and Bedrock-type provider adapters (DH-0171). These
// three pieces were byte-identical or parallel-but-never-consolidated between anthropic.ts and
// bedrock.ts: the raw stop-reason mapping, the cache-marker placement walk (DH-0010 Part A —
// "last message, plus second-to-last user message"), and the error-classification result
// shape. Wire-shape-specific logic (content-block mapping, the actual per-provider error
// taxonomy) stays in each adapter — only the genuinely duplicated control flow moved here.

import type { ProviderErrorKind, ProviderStopReason } from "./types.ts";

/** Both SDKs report the same four raw stop-reason strings dh cares about (plus provider-
 * specific extras dh doesn't model, and a null/undefined "no reason yet" case) — this mapping
 * was byte-identical between anthropic.ts and bedrock.ts. */
export function mapStopReason(reason: string | null | undefined): ProviderStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn") return "end_turn";
  return "other";
}

/** Result shape both adapters' `classify*Error` functions return — the "skeleton" DH-0171
 * flags as parallel-but-never-shared. The actual classification logic (HTTP status codes for
 * Anthropic, AWS exception names for Bedrock) is genuinely different per provider and stays in
 * each adapter; only the shared return contract lives here. */
export interface ErrorClassification {
  kind: ProviderErrorKind;
  retryable: boolean;
}

/** DH-0010 Part B: both adapters detect "the request was rejected for being too long" via a
 * best-effort regex match against the provider's own error message text — same fragile-but-
 * graceful-degradation heuristic, different regex per provider's actual wording. */
export function isContextOverflowMessage(message: string, pattern: RegExp): boolean {
  return pattern.test(message);
}

/** A message with role + content, generic over the provider's own content-block type — used by
 * `withCacheMarkers` below. */
export interface CacheableMessage<C> {
  role: "user" | "assistant";
  content: C[];
}

/** DH-0010 Part A: the cache-marker *placement* walk — mark the last message, and (if one
 * exists) the second-to-last *user* message — is identical between anthropic.ts and
 * bedrock.ts; only how a message's content gets marked differs (Anthropic annotates the
 * existing last content block in place, Bedrock appends a new trailing cachePoint block), which
 * is why marking is a caller-supplied callback. Never mutates the input `messages` array or any
 * of its message objects — always returns a shallow-cloned structure, matching both adapters'
 * pre-DH-0171 "the caller's own message array must survive unchanged across turns" contract. */
export function withCacheMarkers<C>(
  messages: CacheableMessage<C>[],
  mark: (content: C[]) => C[],
): CacheableMessage<C>[] {
  const result = messages.map((m) => ({ ...m, content: [...m.content] }));

  const markAt = (index: number | undefined): void => {
    if (index === undefined) return;
    const msg = result[index];
    if (!msg) return;
    msg.content = mark(msg.content);
  };

  markAt(result.length > 0 ? result.length - 1 : undefined);

  const userIndices = result.reduce<number[]>((acc, m, i) => {
    if (m.role === "user") acc.push(i);
    return acc;
  }, []);
  if (userIndices.length >= 2) {
    markAt(userIndices[userIndices.length - 2]);
  }

  return result;
}
