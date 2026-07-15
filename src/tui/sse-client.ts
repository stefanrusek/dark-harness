// Server -> client SSE stream connection. Wraps SseFrameParser with reconnect-on-drop logic
// per ADR 0002 (resumable via Last-Event-ID). fetch/delay are injectable so this is testable
// against a fake streaming Response without real network I/O.

import type { ServerSentEvent } from "../contracts/index.ts";
import { SseFrameParser, parseServerSentEvent } from "./sse-parser.ts";
import type { ConnectionStatus } from "./types.ts";

// Confirmed against the Server domain's actual route (src/server/server.ts,
// GET /api/events) — see docs/handoffs/tui.md status log.
export const EVENTS_PATH = "/api/events";

const DEFAULT_RECONNECT_DELAY_MS = 1000;
/** Backoff cap (DH-0024): however many consecutive failures pile up, never wait longer than
 * this between attempts — an operator restarting the server shouldn't have to wait minutes
 * for the client to notice. */
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface SseClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  onEvent: (event: ServerSentEvent) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onParseError?: (rawData: string) => void;
  /** Reconnected successfully after one or more failed attempts. Not called for the very
   * first connection of the session — only when a prior attempt actually failed (DH-0024).
   * Callers use this to show an explicit "reconnected — history may be incomplete" notice,
   * since the client's own event buffer (server-side) may not have retained everything that
   * happened while disconnected. */
  onReconnected?: () => void;
  reconnectDelayMs?: number;
  delayImpl?: (ms: number) => Promise<void>;
  /** Injectable source of randomness for reconnect jitter, defaulting to `Math.random`.
   * Overridable so tests can assert exact computed delays deterministically. */
  randomImpl?: () => number;
  signal?: AbortSignal;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "Full jitter" exponential backoff (DH-0024): `random() * min(cap, base * 2^attempt)`.
 * `attempt` is the count of consecutive failures *before* this one, so the very first retry
 * is jittered around the old fixed `base` delay and later retries grow from there, rather
 * than hammering a down server on a flat interval forever. */
function backoffDelayMs(base: number, attempt: number, random: () => number): number {
  const capped = Math.min(MAX_RECONNECT_DELAY_MS, base * 2 ** attempt);
  return random() * capped;
}

/**
 * Connect to the server's SSE stream and invoke `onEvent` per event, reconnecting with
 * `Last-Event-ID` on drop until `options.signal` aborts. Runs until abort — callers should
 * `void` this and hold the AbortController to stop it.
 */
export async function runSseClient(options: SseClientOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.delayImpl ?? defaultDelay;
  const random = options.randomImpl ?? Math.random;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  let lastEventId: string | null = null;
  let consecutiveFailures = 0;

  while (!(options.signal?.aborted ?? false)) {
    options.onConnectionChange?.("connecting");
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
      options.onConnectionChange?.("closed");
    } catch {
      if (options.signal?.aborted) break;
      options.onConnectionChange?.("error");
      // Compute the wait using the failure streak *before* this one counts, so the very
      // first retry is jittered around the old fixed `base` delay rather than already
      // doubled — only the second and later consecutive failures actually back off further.
      const waitMs = backoffDelayMs(reconnectDelayMs, consecutiveFailures, random);
      consecutiveFailures += 1;
      if (options.signal?.aborted) break;
      await delay(waitMs);
      continue;
    }
    if (options.signal?.aborted) break;
    await delay(backoffDelayMs(reconnectDelayMs, consecutiveFailures, random));
  }
}

async function connectOnce(
  options: SseClientOptions,
  fetchImpl: typeof fetch,
  lastEventId: string | null,
  setLastEventId: (id: string) => void,
  onOpen: () => void,
): Promise<void> {
  const headers: Record<string, string> = { accept: "text/event-stream", ...options.headers };
  if (lastEventId !== null) headers["Last-Event-ID"] = lastEventId;

  const response = await fetchImpl(`${options.baseUrl}${EVENTS_PATH}`, {
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: HTTP ${response.status}`);
  }
  onOpen();
  options.onConnectionChange?.("open");

  const parser = new SseFrameParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const frames = parser.push(decoder.decode(value, { stream: true }));
    for (const frame of frames) {
      if (frame.id !== null) setLastEventId(frame.id);
      const event = parseServerSentEvent(frame);
      if (event) {
        options.onEvent(event);
      } else {
        options.onParseError?.(frame.data);
      }
    }
  }
}
