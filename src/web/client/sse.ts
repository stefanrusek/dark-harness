// SSE client: builds the Web-specific request (URL, bearer-token header) and adapts this
// client's `SseHandlers`/`ConnectEventsOptions` API onto the shared client-core transport
// (`runSseTransport`, `src/client-core/sse-transport.ts`) — DH-0186.
//
// DH-0184 extracted the frame parser, permissive payload validator, full-jitter backoff, and
// `Last-Event-ID` reconnect driver this module used to hand-roll into `src/client-core/`
// (Web's own pre-DH-0184 validator was already the permissive shape-check the shared module
// standardized on — see `src/client-core/sse-payload.ts`'s header comment — so this migration
// is a straight wiring swap, no behavior change on that axis). This module now only:
//
// - composes the SSE URL and `Authorization: Bearer <token>` header (ADR 0004 — `EventSource`
//   can't set custom headers, which is why this speaks the wire format over `fetch()` rather
//   than using it; see docs/handoffs/web.md's status log for the fuller reconciliation note),
// - adapts this client's injectable `setTimeoutImpl`/`clearTimeoutImpl` timer deps (used
//   elsewhere in `src/web/client/app.ts`, e.g. the liveness ticker) into the `delayImpl`
//   shape `runSseTransport` expects, wired to abort immediately when `close()` is called, and
// - maps `runSseTransport`'s `onConnectionChange`/`onEvent`/`onReconnected` callbacks onto
//   this module's existing `SseHandlers` shape, unchanged from before the migration.

import type { ConnectionStatus } from "../../client-core/connection-status.ts";
import {
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_RECONNECT_DELAY_MS,
} from "../../client-core/sse-backoff.ts";
import { runSseTransport } from "../../client-core/sse-transport.ts";
import type { ServerSentEvent } from "../../contracts/index.ts";
import { type ServerTarget, sseUrl } from "../protocol.ts";

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
   *  Subsequent attempts back off exponentially, capped at `maxReconnectDelayMs`, and reset
   *  back to this value once a connection succeeds. Defaults to 1000ms. */
  reconnectDelayMs?: number | undefined;
  /** Cap on the backed-off delay, so a genuinely down server is retried on a bounded
   *  cadence instead of the wait growing forever. Defaults to 30000ms. */
  maxReconnectDelayMs?: number | undefined;
  setTimeoutImpl?: typeof setTimeout | undefined;
  clearTimeoutImpl?: typeof clearTimeout | undefined;
  /** Injectable source of randomness for reconnect jitter; defaults to `Math.random`. */
  randomImpl?: (() => number) | undefined;
}

function authHeaders(target: ServerTarget): Record<string, string> {
  const headers: Record<string, string> = {};
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  return headers;
}

/**
 * Adapts this client's injectable `setTimeout`/`clearTimeout` pair into the `Promise`-based
 * `delayImpl` shape `runSseTransport` expects, so existing tests (and `app.ts`'s own fake
 * timers, used elsewhere for the liveness ticker) keep driving reconnect delays by invoking
 * the captured timer callback directly rather than waiting in real time. Resolves early —
 * clearing the pending timeout — if `signal` aborts first, so `close()` doesn't leave a
 * dangling scheduled reconnect.
 */
function makeDelayImpl(
  setTimeoutImpl: typeof setTimeout,
  clearTimeoutImpl: typeof clearTimeout,
  signal: AbortSignal,
): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve) => {
      const handle = setTimeoutImpl(() => resolve(), ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeoutImpl(handle);
          resolve();
        },
        { once: true },
      );
    });
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
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const controller = new AbortController();

  // DH-0186 preserves Web's original `onReconnected` semantics locally rather than passing
  // `handlers.onReconnected` straight through to `runSseTransport`'s own `onReconnected`:
  // the shared transport only fires its `onReconnected` after a *failed* connect attempt
  // (an exception or non-OK response) — the behavior `src/tui/sse-client.ts` (pre-DH-0185)
  // already had. Web's pre-migration behavior was broader: any successful connect after the
  // first counted as a reconnect, including a *clean* stream end (e.g. the server cleanly
  // closing the response on a restart) — exactly the DH-0024 "may have missed events" case
  // the gap banner exists for, and one that never throws so the shared transport's stricter
  // check would silently miss it for Web. Deriving it from the `live` transitions this
  // module already sees keeps that broader guarantee without changing the shared module's
  // (correct-for-TUI) default.
  let everConnected = false;
  void runSseTransport({
    url: sseUrl(target),
    fetchImpl: options.fetchImpl ?? fetch,
    headers: authHeaders(target),
    onEvent: handlers.onEvent,
    onConnectionChange: (status) => {
      if (status === "live") {
        if (everConnected) handlers.onReconnected?.();
        everConnected = true;
      }
      handlers.onStatusChange(status);
    },
    reconnectDelayMs: options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
    delayImpl: makeDelayImpl(setTimeoutImpl, clearTimeoutImpl, controller.signal),
    randomImpl: options.randomImpl ?? Math.random,
    signal: controller.signal,
  });

  return {
    close(): void {
      controller.abort();
    },
  };
}
