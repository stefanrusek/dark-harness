// DH-0020, design D3 (Fable, 2026-07-15): secrets redaction for the JSONL log-writing
// layer (`SessionLogger.append`), applied to the already-serialized JSON line — see that
// file's doc comment for why redaction lives here and not in `loop.ts`.
//
// Two complementary, priority-ordered mechanisms:
//   1. Known-value (exact match): real secrets the harness itself holds in loaded config
//      (`security.token`, provider `apiKey`s, MCP header values), matched in their
//      JSON-escaped form since matching happens post-serialization. This is the
//      catastrophic case (an attacker downloading logs over plaintext HTTP could reuse
//      these directly against dh itself), closed exactly regardless of the secret's shape.
//   2. Pattern (high-precision only): a fixed table of well-known secret formats that pass
//      through tool I/O but that dh does not itself hold. Deliberately conservative — no
//      generic `key=value`/`key: value` context matching (rejected per the design: dh's own
//      dogfooding logs Read/Edit/Write output full of source code where `token`/`secret`
//      are ordinary identifiers, and a fuzzy pattern would shred legitimate diffs).
//
// Every pattern here must be linear-time-safe (no nested quantifiers prone to catastrophic
// backtracking) since this runs on every logged line.

import type { DhConfig, ServerSentEvent } from "../contracts/index.ts";

/** Guard: a secret shorter than this is not redacted by exact match — a pathological
 * 1-char "token" in config must not shred the log (per the design's explicit guard). */
const MIN_KNOWN_SECRET_LENGTH = 8;

/** Escapes a string for safe interpolation into a `RegExp` (treats every character as
 * literal). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Renders `value` exactly as it would appear inside a JSON string literal (quotes
 * stripped) — matching happens on already-serialized JSON text, so a known secret must be
 * matched in its JSON-escaped form, not its raw form. */
function jsonEscapedForm(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Fixed, documented pattern table (DH-0020 D3). Order matters for a couple of overlapping
 * cases (e.g. an Anthropic key embedded in an `Authorization: Bearer` header): earlier
 * patterns run first, so a more specific label wins where two patterns could otherwise
 * both match the same substring.
 */
const PATTERNS: Array<{
  label: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}> = [
  {
    label: "anthropic-key",
    pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g,
    replace: () => "[REDACTED:anthropic-key]",
  },
  {
    label: "api-key",
    pattern: /sk-[A-Za-z0-9_-]{24,}/g,
    replace: () => "[REDACTED:api-key]",
  },
  {
    label: "aws-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => "[REDACTED:aws-key-id]",
  },
  {
    label: "aws-secret",
    pattern: /\b(aws_secret_access_key|aws_session_token)\b(["']?\s*[=:]\s*["']?)\S+/gi,
    replace: (_match, key: string, sep: string) => `${key}${sep}[REDACTED:aws-secret]`,
  },
  {
    label: "auth-header",
    pattern: /\b(authorization)\b(["']?\s*:\s*)(bearer|basic|token)?\s*\S+/gi,
    replace: (_match, word: string, sep: string, scheme: string | undefined) =>
      `${word}${sep}${scheme ? `${scheme} ` : ""}[REDACTED:auth-header]`,
  },
  {
    label: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    replace: () => "[REDACTED:github-token]",
  },
  {
    label: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => "[REDACTED:jwt]",
  },
  {
    label: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => "[REDACTED:slack-token]",
  },
  {
    label: "google-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => "[REDACTED:google-key]",
  },
];

/**
 * Redacts secrets from an already-serialized JSON-line string. Known-value (exact) matches
 * are applied first, then the fixed pattern table, in the priority order documented above.
 * Every replacement token is `[REDACTED:<label>]` (or a keyed variant that preserves a
 * header/key name) — none contain quotes or backslashes, so substituting one inside a JSON
 * string value always leaves the line valid JSON.
 */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret.length < MIN_KNOWN_SECRET_LENGTH) continue;
    const escaped = escapeRegExp(jsonEscapedForm(secret));
    if (escaped.length === 0) continue;
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED:config-secret]");
  }
  for (const { pattern, replace } of PATTERNS) {
    result = result.replace(pattern, replace as (...args: string[]) => string);
  }
  return result;
}

/**
 * Collects every real secret value the loaded config holds — `security.token`, every
 * provider `apiKey`, and every MCP server header value — for exact-match redaction via
 * `redactSecrets`. No length filtering here (the guard lives in `redactSecrets` itself so
 * every caller gets it uniformly); duplicates are harmless (just a redundant regex pass).
 */
export function collectConfigSecrets(config: DhConfig): string[] {
  const secrets: string[] = [];
  if (config.security?.token) secrets.push(config.security.token);
  for (const provider of config.provider ?? []) {
    if (provider.apiKey) secrets.push(provider.apiKey);
  }
  for (const server of Object.values(config.mcpServers ?? {})) {
    for (const value of Object.values(server.headers ?? {})) {
      secrets.push(value);
    }
  }
  return secrets;
}

/**
 * DH-0089 D4: redacts a single live SSE event before it reaches the wire or the resume
 * buffer. Unlike `SessionLogger.append` (which redacts an already-serialized JSON line),
 * this runs on the in-memory event object — only `tool_call`'s `inputSummary` can ever carry
 * secret-shaped text (an MCP tool call's arguments), since every other event type's fields
 * are either structural (ids, counts, timestamps) or already-vetted display text. Identity
 * (same reference) for every other event type, so callers that don't need to reallocate
 * (e.g. hot paths with no `tool_call` events) pay no cost.
 *
 * Accepted residual risk (documented in the design, not fixed here): Core truncates
 * `inputSummary` to 200 chars before this runs, so a secret straddling the truncation
 * boundary can lose exact-match (known-secret) redaction — pattern-based redaction still
 * catches recognizable prefixes (e.g. `sk-ant-…`) even when truncated.
 */
export function sanitizeEvent(
  event: ServerSentEvent,
  knownSecrets: readonly string[] = [],
): ServerSentEvent {
  if (event.type !== "tool_call") return event;
  return { ...event, inputSummary: redactSecrets(event.inputSummary, knownSecrets) };
}
