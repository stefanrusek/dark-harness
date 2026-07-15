import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison safe for variable-length secrets (ADR 0004: "constant-time
 * compare, never logged"). `crypto.timingSafeEqual` requires equal-length buffers and
 * throws otherwise — comparing raw strings of different lengths would either throw (a
 * length side-channel) or require an early-return length check (also a side channel).
 * Hashing both sides to a fixed-length digest first removes the length signal entirely.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

const BEARER_PREFIX = "Bearer ";

/** Extracts the bearer token from an `Authorization` header value, or null if absent/malformed. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  if (!authorizationHeader.startsWith(BEARER_PREFIX)) return null;
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Whether a request is authorized per ADR 0004. When `expectedToken` is undefined/empty,
 * bearer-token auth is disabled (the plaintext-by-default posture) and every request
 * passes. Otherwise the request must carry `Authorization: Bearer <expectedToken>`,
 * checked in constant time.
 */
export function isAuthorized(
  authorizationHeader: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return true;
  const provided = extractBearerToken(authorizationHeader);
  if (provided === null) return false;
  return constantTimeEqual(provided, expectedToken);
}
