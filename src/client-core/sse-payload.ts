// Validates a raw SSE frame's `data:` payload as a `ServerSentEvent` — shared by the TUI and
// Web clients (DH-0184).
//
// ARCHITECT DECISION (DH-0170's decomposition, "validation-strictness divergence"): the two
// clients' independent implementations diverged. The TUI's `isServerSentEvent`
// (`src/tui/sse-parser.ts`, pre-DH-0184) additionally required `record.type` to be a member of
// a hardcoded `KNOWN_TYPES` set. That was a confirmed **latent bug**, not a deliberate
// stricter check: `KNOWN_TYPES` omitted `model_switched`, `resync`, and `agent_thinking` even
// though all three are present in the contracts `ServerSentEvent` union (`events.type.ts`) and
// are actively handled by the TUI's own reducer (`src/tui/state.ts`) — so those three event
// types were silently dropped at the parser, before ever reaching the reducer. The Web client's
// `parseEventPayload` (`src/web/client/sse.ts`, pre-DH-0184) never had this problem: it only
// checked `typeof parsed.type === "string"`, no allowlist.
//
// The canonical validator below is the **permissive shape-check**: `version`/`id`/`timestamp`/
// `type` present and correctly typed, no event-type allowlist. Tolerating unknown/future event
// types here is intentional — filtering them is the reducer's job (both reducers already fold
// unrecognized types through an exhaustiveness default), not the transport's.

import type { ServerSentEvent } from "../contracts/index.ts";

/**
 * Parse a `data:` field payload (already isolated from the raw SSE frame) as a
 * `ServerSentEvent`. Returns `null` (rather than throwing) on malformed JSON or a
 * non-conforming shape, so a single bad frame doesn't take down the client — callers should
 * surface a status message instead of crashing.
 */
export function parseServerSentEventPayload(data: string): ServerSentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isServerSentEvent(parsed)) return null;
  return parsed;
}

function isServerSentEvent(value: unknown): value is ServerSentEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.type === "string"
  );
}
