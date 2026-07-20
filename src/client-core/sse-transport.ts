// Shared SSE transport: connects to a server SSE stream and invokes `onEvent` per event,
// reconnecting with `Last-Event-ID` and full-jitter backoff on drop, per ADR 0002 (resumable
// via Last-Event-ID). DH-0184 extracted this out of `src/tui/sse-client.ts` and
// `src/web/client/sse.ts` (see DH-0170's architect decomposition notes) — both clients
// independently arrived at the same design (fetch-based, not `EventSource`, since the Web
// client's bearer-token auth needs custom headers `EventSource` can't set) and had converged
// on byte-equivalent backoff constants. `fetchImpl`/`delayImpl`/`randomImpl` are injectable so
// this is testable against a fake streaming `Response` without real network I/O or real
// timers.
//
// This module ships the reconnect *driver*; it does not build the request URL/headers beyond
// what's passed in, and it does not own any client-specific `ConnectionStatus` display wiring
// beyond invoking the `onConnectionChange` callback with the shared vocabulary
// (`./connection-status.ts`). Migrating the TUI and Web clients onto this module is out of
// scope here — see DH-0185 (TUI) and DH-0186 (Web).

import type { ServerSentEvent } from "../contracts/index.ts";
import type { ConnectionStatus } from "./connection-status.ts";
import {
  computeBackoffDelayMs,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_RECONNECT_DELAY_MS,
} from "./sse-backoff.ts";
import { SseFrameParser } from "./sse-frame-parser.ts";
import { parseServerSentEventPayload } from "./sse-payload.ts";

export interface SseTransportOptions {
  /** Full URL of the SSE endpoint (e.g. `${baseUrl}/api/events`). Built by the caller so this
   * module stays agnostic of how each client composes its server target. */
  url: string;
  fetchImpl?: typeof fetch;
  /** Static headers sent on every (re)connect attempt, in addition to `accept` and (when a
   * prior frame supplied one) `Last-Event-ID` — both of which this module sets itself. */
  headers?: Record<string, string>;
  onEvent: (event: ServerSentEvent) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  /** A frame's `data:` payload failed to parse as a `ServerSentEvent` — see
   * `./sse-payload.ts` for the (deliberately permissive) validation rules. */
  onParseError?: (rawData: string) => void;
  /** Reconnected successfully after one or more failed attempts. Not called for the very
   * first connection of the session — only when a prior attempt actually failed (DH-0024).
   * Callers use this to show an explicit "reconnected — history may be incomplete" notice,
   * since the server-side event buffer may not have retained everything that happened while
   * disconnected. */
  onReconnected?: () => void;
  /** DH-0166: upper bound on *consecutive* failed connection attempts before the transport
   * gives up: once this many attempts in a row have failed without a single successful open
   * in between, the loop stops retrying, reports `disconnected`, and calls `onGiveUp`. Any
   * successful open resets the streak. Omitted (the default, and the Web client's behavior)
   * means retry forever — the pre-DH-0166 behavior. */
  maxConsecutiveFailures?: number;
  /** DH-0166: the transport stopped retrying because `maxConsecutiveFailures` consecutive
   * attempts failed. Called at most once, with the last attempt's error, right before the
   * final `disconnected` status. Callers use this to surface a clear, terminal error instead
   * of letting a status display spin on `reconnecting` forever. */
  onGiveUp?: (lastError: unknown) => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  delayImpl?: (ms: number) => Promise<void>;
  /** Injectable source of randomness for reconnect jitter, defaulting to `Math.random`.
   * Overridable so tests can assert exact computed delays deterministically. */
  randomImpl?: () => number;
  signal?: AbortSignal;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect to a server's SSE stream and invoke `onEvent` per event, reconnecting with
 * `Last-Event-ID` on drop until `options.signal` aborts. Runs until abort — callers should
 * `void` this and hold the `AbortController` used to stop it.
 */
export async function runSseTransport(options: SseTransportOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.delayImpl ?? defaultDelay;
  const random = options.randomImpl ?? Math.random;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
  let lastEventId: string | null = null;
  let consecutiveFailures = 0;

  while (!(options.signal?.aborted ?? false)) {
    // `connecting` only for the very first attempt of the session (no `Last-Event-ID` seen
    // yet); any attempt after a prior drop is `reconnecting` (docs/design/style-guide.md
    // §1/§6).
    options.onConnectionChange?.(lastEventId !== null ? "reconnecting" : "connecting");
    try {
      await connectOnce(
        options,
        fetchImpl,
        lastEventId,
        (id) => {
          lastEventId = id;
        },
        () => {
          // A real HTTP-level connection was established. Notify only when this follows one or
          // more failures — the operator's view may have missed events while disconnected.
          if (consecutiveFailures > 0) options.onReconnected?.();
          consecutiveFailures = 0;
        },
      );
      // The stream ended cleanly (server closed it, no exception) — not fatal, the loop
      // immediately retries below just like after a failed attempt, so it's reported the
      // same way: `reconnecting`.
      options.onConnectionChange?.("reconnecting");
    } catch (err) {
      if (options.signal?.aborted) break;
      // DH-0166: bounded-retry callers (the TUI talking to its own same-process server) stop
      // here once the streak hits the cap — an unbounded `reconnecting` spinner against a
      // non-transient failure is exactly the opaque failure mode that ticket escalated on.
      if (
        options.maxConsecutiveFailures !== undefined &&
        consecutiveFailures + 1 >= options.maxConsecutiveFailures
      ) {
        options.onGiveUp?.(err);
        break;
      }
      // A failed attempt otherwise always leads to another retry — that's exactly what the
      // shared `reconnecting` state means, not a fatal `error`.
      options.onConnectionChange?.("reconnecting");
      // Compute the wait using the failure streak *before* this one counts, so the very
      // first retry is jittered around the plain `base` delay rather than already doubled —
      // only the second and later consecutive failures actually back off further.
      const waitMs = computeBackoffDelayMs(
        consecutiveFailures,
        reconnectDelayMs,
        maxReconnectDelayMs,
        random,
      );
      consecutiveFailures += 1;
      if (options.signal?.aborted) break;
      await delay(waitMs);
      continue;
    }
    if (options.signal?.aborted) break;
    await delay(
      computeBackoffDelayMs(consecutiveFailures, reconnectDelayMs, maxReconnectDelayMs, random),
    );
  }
  // The loop exits via `signal.aborted` (deliberate teardown) or the DH-0166 give-up branch
  // above — both are genuine "stopped trying" cases. Report `disconnected` here so a header/
  // status display doesn't freeze on a stale `reconnecting`/`live` label either way.
  options.onConnectionChange?.("disconnected");
}

async function connectOnce(
  options: SseTransportOptions,
  fetchImpl: typeof fetch,
  lastEventId: string | null,
  setLastEventId: (id: string) => void,
  onOpen: () => void,
): Promise<void> {
  const headers: Record<string, string> = { accept: "text/event-stream", ...options.headers };
  if (lastEventId !== null) headers["Last-Event-ID"] = lastEventId;

  const response = await fetchImpl(options.url, {
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: HTTP ${response.status}`);
  }
  onOpen();
  options.onConnectionChange?.("live");

  const parser = new SseFrameParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const frames = parser.push(decoder.decode(value, { stream: true }));
    for (const frame of frames) {
      if (frame.id !== null) setLastEventId(frame.id);
      const event = parseServerSentEventPayload(frame.data);
      if (event) {
        options.onEvent(event);
      } else {
        options.onParseError?.(frame.data);
      }
    }
  }
}
