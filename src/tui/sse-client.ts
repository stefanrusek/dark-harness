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

export interface SseClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  onEvent: (event: ServerSentEvent) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onParseError?: (rawData: string) => void;
  reconnectDelayMs?: number;
  delayImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect to the server's SSE stream and invoke `onEvent` per event, reconnecting with
 * `Last-Event-ID` on drop until `options.signal` aborts. Runs until abort — callers should
 * `void` this and hold the AbortController to stop it.
 */
export async function runSseClient(options: SseClientOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.delayImpl ?? defaultDelay;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  let lastEventId: string | null = null;

  while (!(options.signal?.aborted ?? false)) {
    options.onConnectionChange?.("connecting");
    try {
      await connectOnce(options, fetchImpl, lastEventId, (id) => {
        lastEventId = id;
      });
      options.onConnectionChange?.("closed");
    } catch {
      if (options.signal?.aborted) break;
      options.onConnectionChange?.("error");
    }
    if (options.signal?.aborted) break;
    await delay(reconnectDelayMs);
  }
}

async function connectOnce(
  options: SseClientOptions,
  fetchImpl: typeof fetch,
  lastEventId: string | null,
  setLastEventId: (id: string) => void,
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
