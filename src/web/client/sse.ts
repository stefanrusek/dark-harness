// SSE client speaking the wire format directly over `fetch()`, rather than the browser's
// native `EventSource`.
//
// Why not `EventSource`: ADR 0004's bearer-token auth requires an `Authorization: Bearer
// <token>` header on every request, including the SSE stream — but the `EventSource` spec
// gives it no way to set custom headers. The Server domain lead (Radia) flagged this as a
// real interoperability gap rather than unilaterally adding a `?token=` query-string
// fallback (query strings leak into proxy/access logs far more readily than headers, which
// would be a security-posture change outside her call to make alone — see
// docs/handoffs/server.md's status log). Of the options she raised, this module implements
// the one that stays entirely inside Web's own ownership and touches no security posture:
// read the SSE stream ourselves via `fetch()`, which — unlike `EventSource` — can set any
// header we like. See docs/handoffs/web.md's status log for the fuller reconciliation note.
//
// This module re-derives the small slice of `EventSource` behavior this app actually
// depends on: SSE field parsing (`id:`/`data:`/comment lines, blank-line-terminated
// records — matches `src/server/sse.ts`'s `formatSseEvent` wire format, plus tolerance for
// the general spec shape so it isn't brittle to future server changes), automatic
// reconnect with backoff, and `Last-Event-ID` resend on reconnect. The console TUI
// (`src/tui/sse-parser.ts`, `src/tui/sse-client.ts`) solves the same problem the same way
// for the same reason — independently arrived at, not shared code; see
// docs/handoffs/web.md's status log for why extracting a shared parser was judged not
// worth it this round.

import type { ServerSentEvent } from "../../contracts/index.ts";
import { type ServerTarget, sseUrl } from "../protocol.ts";
import type { ConnectionStatus } from "./state.ts";

export interface SseHandlers {
  onEvent(event: ServerSentEvent): void;
  onStatusChange(status: ConnectionStatus): void;
}

export type SseFetch = typeof fetch;

export interface SseConnection {
  close(): void;
}

export interface ConnectEventsOptions {
  fetchImpl?: SseFetch | undefined;
  /** Delay before retrying after the stream drops or fails to open. Defaults to 2000ms. */
  reconnectDelayMs?: number | undefined;
  setTimeoutImpl?: typeof setTimeout | undefined;
  clearTimeoutImpl?: typeof clearTimeout | undefined;
}

export interface SseRecord {
  id?: string | undefined;
  data?: string | undefined;
}

const DEFAULT_RECONNECT_DELAY_MS = 2000;

/**
 * Incrementally parses a decoded SSE text stream into `{ id, data }` records, split on the
 * blank-line record terminator. Buffers a trailing partial record across `push()` calls, so
 * it tolerates the stream being chunked at arbitrary byte boundaries.
 */
export class SseStreamParser {
  private buffer = "";

  // Explicit (if empty) constructor: a class with only field initializers and no
  // constructor of its own leaves Bun's coverage instrumentation treating the synthetic
  // default constructor as never "hit," even though `new SseStreamParser()` runs on every
  // (re)connect — a known instrumentation quirk (see docs/roster/radia.md), not a real gap.
  // biome-ignore lint/complexity/noUselessConstructor: works around the coverage quirk above.
  constructor() {}

  push(chunk: string): SseRecord[] {
    // Normalize CRLF to LF up front so blank-line detection below (which only looks for
    // "\n\n") also matches a "\r\n\r\n" terminator — `formatSseEvent` only ever emits LF,
    // but the SSE spec permits CRLF, so this keeps the parser correct against any spec-
    // conforming producer, not just our own server.
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const records: SseRecord[] = [];
    let sep = this.buffer.indexOf("\n\n");
    while (sep !== -1) {
      records.push(parseBlock(this.buffer.slice(0, sep)));
      this.buffer = this.buffer.slice(sep + 2);
      sep = this.buffer.indexOf("\n\n");
    }
    return records;
  }
}

function parseBlock(block: string): SseRecord {
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    // Comment lines (leading ':') are part of the SSE spec — the server sends a leading
    // `: connected` keep-alive line (src/server/server.ts) purely to flush headers early.
    if (line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    // Per SSE field-parsing rules, multiple `data:` lines in one record join with `\n` —
    // never produced by `formatSseEvent` today (JSON-encoding a chunk can't contain a raw
    // newline), but handling it costs little and keeps this parser forward-compatible.
  }
  return { id, data: dataLines.length > 0 ? dataLines.join("\n") : undefined };
}

export function parseEventPayload(raw: unknown): ServerSentEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as ServerSentEvent;
    }
    return null;
  } catch {
    return null;
  }
}

function requestHeaders(target: ServerTarget, lastEventId: string | null): HeadersInit {
  const headers: Record<string, string> = {};
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  return headers;
}

/**
 * Opens the SSE stream and keeps it open, retrying with a fixed backoff on any drop
 * (network error, non-OK response, the server closing the stream) until `close()` is
 * called. Every (re)connect attempt resends the highest event id seen so far via
 * `Last-Event-ID`, so a reconnect resumes rather than replaying from the start.
 */
export function connectEvents(
  target: ServerTarget,
  handlers: SseHandlers,
  options: ConnectEventsOptions = {},
): SseConnection {
  const fetchImpl = options.fetchImpl ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;

  let closed = false;
  let lastEventId: string | null = null;
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect(): void {
    if (closed) return;
    handlers.onStatusChange("reconnecting");
    reconnectTimer = setTimeoutImpl(() => {
      void run();
    }, reconnectDelayMs);
  }

  async function run(): Promise<void> {
    if (closed) return;
    handlers.onStatusChange(lastEventId ? "reconnecting" : "connecting");
    abortController = new AbortController();

    let response: Response;
    try {
      response = await fetchImpl(sseUrl(target), {
        headers: requestHeaders(target, lastEventId),
        signal: abortController.signal,
      });
    } catch {
      scheduleReconnect();
      return;
    }
    if (closed) return;
    if (!response.ok || !response.body) {
      scheduleReconnect();
      return;
    }

    handlers.onStatusChange("open");
    const parser = new SseStreamParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const record of parser.push(decoder.decode(value, { stream: true }))) {
          if (record.id) lastEventId = record.id;
          const event = parseEventPayload(record.data);
          if (event) handlers.onEvent(event);
        }
      }
    } catch {
      // Fall through to reconnect below — a mid-stream read failure is treated the same as
      // a clean end-of-stream: retry from the last seen event id.
    }
    if (closed) return;
    scheduleReconnect();
  }

  void run();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (reconnectTimer !== undefined) clearTimeoutImpl(reconnectTimer);
      abortController?.abort();
      handlers.onStatusChange("closed");
    },
  };
}
