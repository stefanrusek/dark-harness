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
  /**
   * Fired when a connection attempt succeeds *after* a prior drop (i.e. this is a
   * reconnect, not the initial connect of a fresh session). DH-0024: neither client
   * previously gave any indication that a reconnect might have missed events — a
   * fixed-delay reconnect looked identical to a fresh, gap-free resume. There is no
   * server-side gap/resync signal yet to distinguish a brief blip from a full session
   * restart (tracked separately in DH-0019 — a `src/contracts/` wire change Web can't add
   * unilaterally); until that lands, every reconnect is conservatively treated as a
   * possible gap, since resuming via `Last-Event-ID` after any drop can miss events the
   * server evicted or a restart in between. Optional so existing callers/tests don't need
   * to change.
   */
  onReconnected?(): void;
}

export type SseFetch = typeof fetch;

export interface SseConnection {
  close(): void;
}

export interface ConnectEventsOptions {
  fetchImpl?: SseFetch | undefined;
  /** Initial delay before the first retry after the stream drops or fails to open.
   *  Subsequent attempts back off exponentially (see `nextReconnectDelayMs`), capped at
   *  `maxReconnectDelayMs`, and reset back to this value once a connection succeeds.
   *  Defaults to 1000ms. */
  reconnectDelayMs?: number | undefined;
  /** Cap on the backed-off delay, so a genuinely down server is retried on a bounded
   *  cadence instead of the wait growing forever. Defaults to 30000ms. */
  maxReconnectDelayMs?: number | undefined;
  setTimeoutImpl?: typeof setTimeout | undefined;
  clearTimeoutImpl?: typeof clearTimeout | undefined;
  /** Injectable source of randomness for reconnect jitter; defaults to `Math.random`. */
  randomImpl?: (() => number) | undefined;
}

export interface SseRecord {
  id?: string | undefined;
  data?: string | undefined;
}

const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Full-jitter exponential backoff (DH-0024): doubles the delay on each successive failed
 * attempt (attempt 0 = first retry), capped at `maxDelayMs`, then picks a random value in
 * `[0, cappedDelay]` rather than using the capped value outright — jitter keeps clients that
 * all dropped at the same moment (e.g. a server restart) from reconnecting in lockstep and
 * re-hammering it the instant it comes back.
 */
export function nextReconnectDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  randomFn: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(randomFn() * capped);
}

/**
 * Incrementally parses a decoded SSE text stream into `{ id, data }` records, split on the
 * blank-line record terminator. Buffers a trailing partial record across `push()` calls, so
 * it tolerates the stream being chunked at arbitrary byte boundaries.
 */
export class SseStreamParser {
  private buffer: string;

  constructor() {
    // Real assignment (not a field initializer) so the constructor body itself executes and
    // is counted as covered — a class with only field initializers and no constructor body
    // left Bun's coverage instrumentation treating the synthetic default constructor as never
    // "hit," even though `new SseStreamParser()` runs on every (re)connect.
    this.buffer = "";
  }

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
 * Opens the SSE stream and keeps it open, retrying with exponential backoff + full jitter
 * (DH-0024) on any drop (network error, non-OK response, the server closing the stream)
 * until `close()` is called. Every (re)connect attempt resends the highest event id seen so
 * far via `Last-Event-ID`, so a reconnect resumes rather than replaying from the start.
 * `handlers.onReconnected` fires once per successful reconnect (not the initial connect) —
 * see its doc comment for why every reconnect is treated as a possible gap.
 */
export function connectEvents(
  target: ServerTarget,
  handlers: SseHandlers,
  options: ConnectEventsOptions = {},
): SseConnection {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseReconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
  const randomImpl = options.randomImpl ?? Math.random;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;

  let closed = false;
  let lastEventId: string | null = null;
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of consecutive failed (re)connect attempts, driving the backoff delay. Reset to
   *  0 once a connection opens successfully. */
  let reconnectAttempt = 0;
  /** Whether any connection has ever opened successfully — the first successful open is
   *  the initial connect, not a reconnect, so it must not fire `onReconnected`. */
  let everConnected = false;

  function scheduleReconnect(): void {
    if (closed) return;
    handlers.onStatusChange("reconnecting");
    const delay = nextReconnectDelayMs(
      reconnectAttempt,
      baseReconnectDelayMs,
      maxReconnectDelayMs,
      randomImpl,
    );
    reconnectAttempt++;
    reconnectTimer = setTimeoutImpl(() => {
      void run();
    }, delay);
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

    const isReconnect = everConnected;
    everConnected = true;
    reconnectAttempt = 0;
    handlers.onStatusChange("live");
    if (isReconnect) handlers.onReconnected?.();
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
      handlers.onStatusChange("disconnected");
    },
  };
}
