import type { ServerSentEvent } from "../contracts/index.ts";

/**
 * Encodes one ServerSentEvent as wire-format SSE bytes: an `id:` line matching
 * `event.id` (ADR 0002 — this is what makes `Last-Event-ID` resume work), a `data:` line
 * carrying the JSON-encoded event, and the blank-line record terminator.
 *
 * `JSON.stringify` always escapes newlines inside string values (`\n` becomes the two
 * characters `\` `n`), so the encoded JSON never contains a raw line break — one `data:`
 * line per event is always sufficient; no need for multi-line `data:` framing.
 */
export function formatSseEvent(event: ServerSentEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
