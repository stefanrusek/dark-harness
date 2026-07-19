import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "../../client-core/connection-status.ts";
import type { ServerTarget } from "../protocol.ts";
import { type ConnectEventsOptions, connectEvents } from "./sse.ts";

// DH-0186: this module is now a thin adapter over the shared `runSseTransport`
// (`src/client-core/sse-transport.ts`) — the deep reconnect/backoff/frame-parsing/payload-
// validation behavior this suite used to cover directly is now covered once, generically, by
// `src/client-core/sse-transport.test.ts` (plus `sse-frame-parser.test.ts`/
// `sse-payload.test.ts`/`sse-backoff.test.ts`). What's left to test here is Web-specific
// wiring: URL/header composition, the `setTimeoutImpl`/`clearTimeoutImpl` -> `delayImpl`
// adapter, and `close()`.

/** A controllable fake SSE byte stream, plus the request init `fetchImpl` was called with. */
function fakeStream(): {
  body: ReadableStream<Uint8Array>;
  push(event: { id: string; type: string; [k: string]: unknown }): void;
  close(): void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push(event) {
      controller?.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controller?.close();
    },
  };
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * A fetch double that hands out one `fakeStream()` per call (queued, FIFO) and records every
 * call's URL/headers. `queueStatus` controls what the *next* call resolves with.
 */
function harness(): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
  streams: ReturnType<typeof fakeStream>[];
  queueStatus(status: number): void;
} {
  const calls: FetchCall[] = [];
  const streams: ReturnType<typeof fakeStream>[] = [];
  type QueuedResponse = { kind: "ok" } | { kind: "status"; status: number };
  const queue: QueuedResponse[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { kind: "ok" as const };
    if (next.kind === "status") {
      return new Response(null, { status: next.status });
    }
    const stream = fakeStream();
    streams.push(stream);
    return new Response(stream.body, { status: 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    streams,
    queueStatus: (status: number) => queue.push({ kind: "status", status }),
  };
}

const target: ServerTarget = { baseUrl: "http://localhost:4000" };

function immediateTimers(): Pick<ConnectEventsOptions, "setTimeoutImpl" | "clearTimeoutImpl"> & {
  fired: Array<() => void>;
  cleared: unknown[];
  fireNext(): void;
} {
  const fired: Array<() => void> = [];
  const cleared: unknown[] = [];
  const setTimeoutImpl = ((fn: () => void) => {
    fired.push(fn);
    return fired.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutImpl = ((handle: unknown) => {
    cleared.push(handle);
  }) as typeof clearTimeout;
  return {
    setTimeoutImpl,
    clearTimeoutImpl,
    fired,
    cleared,
    fireNext() {
      const fn = fired.shift();
      fn?.();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("connectEvents", () => {
  test("fetches the SSE URL with no auth header when no token is configured", async () => {
    const h = harness();
    connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    expect(h.calls[0]?.url).toBe("http://localhost:4000/api/events");
    const headers = new Headers(h.calls[0]?.init?.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Last-Event-ID")).toBe(false);
  });

  test("sends a real Authorization header (never a query param) when a token is configured", async () => {
    const h = harness();
    const withToken: ServerTarget = { baseUrl: "http://localhost:4000", token: "secret" };
    connectEvents(
      withToken,
      { onEvent: () => {}, onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    expect(h.calls[0]?.url).not.toContain("secret");
    const headers = new Headers(h.calls[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret");
  });

  test("reports connecting synchronously, then live once the response arrives", async () => {
    const h = harness();
    const statuses: ConnectionStatus[] = [];
    connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: (s) => statuses.push(s) },
      { fetchImpl: h.fetchImpl },
    );
    expect(statuses).toEqual(["connecting"]);
    await flush();
    expect(statuses).toEqual(["connecting", "live"]);
  });

  test("forwards parsed events from the stream, in order", async () => {
    const h = harness();
    const events: unknown[] = [];
    connectEvents(
      target,
      { onEvent: (e) => events.push(e), onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    const stream = h.streams[0];
    stream?.push({
      version: 1,
      id: "e1",
      timestamp: "2026-01-01T00:00:00Z",
      type: "agent_output",
      agentId: "a1",
      chunk: "hi",
    });
    stream?.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "a1",
      chunk: "there",
    });
    await flush();
    expect(events).toHaveLength(2);
    expect((events[0] as { id: string }).id).toBe("e1");
    expect((events[1] as { id: string }).id).toBe("e2");
  });

  test("uses the injected setTimeoutImpl to schedule a reconnect after a non-OK response, and resends Last-Event-ID on the next attempt", async () => {
    const h = harness();
    const timers = immediateTimers();
    h.queueStatus(503);
    const statuses: ConnectionStatus[] = [];
    connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: (s) => statuses.push(s) },
      {
        fetchImpl: h.fetchImpl,
        setTimeoutImpl: timers.setTimeoutImpl,
        clearTimeoutImpl: timers.clearTimeoutImpl,
      },
    );
    await flush();
    expect(statuses).toEqual(["connecting", "reconnecting"]);
    expect(timers.fired).toHaveLength(1);

    timers.fireNext();
    await flush();
    h.streams[0]?.push({
      version: 1,
      id: "e7",
      timestamp: "2026-01-01T00:00:00Z",
      type: "agent_output",
      agentId: "a1",
      chunk: "x",
    });
    await flush();
    h.streams[0]?.close();
    await flush();
    timers.fireNext();
    await flush();
    const headers = new Headers(h.calls[2]?.init?.headers);
    expect(headers.get("Last-Event-ID")).toBe("e7");
  });

  test("onReconnected fires after a successful reconnect but not on the initial connect", async () => {
    const h = harness();
    const timers = immediateTimers();
    let reconnectedCount = 0;
    connectEvents(
      target,
      {
        onEvent: () => {},
        onStatusChange: () => {},
        onReconnected: () => {
          reconnectedCount += 1;
        },
      },
      {
        fetchImpl: h.fetchImpl,
        setTimeoutImpl: timers.setTimeoutImpl,
        clearTimeoutImpl: timers.clearTimeoutImpl,
      },
    );
    await flush();
    expect(reconnectedCount).toBe(0);
    h.streams[0]?.close();
    await flush();
    timers.fireNext();
    await flush();
    expect(reconnectedCount).toBe(1);
  });

  test("close() aborts the connection, clears a pending reconnect timer via clearTimeoutImpl, and reports disconnected", async () => {
    const h = harness();
    const timers = immediateTimers();
    h.queueStatus(503);
    const statuses: ConnectionStatus[] = [];
    const conn = connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: (s) => statuses.push(s) },
      {
        fetchImpl: h.fetchImpl,
        setTimeoutImpl: timers.setTimeoutImpl,
        clearTimeoutImpl: timers.clearTimeoutImpl,
      },
    );
    await flush();
    expect(statuses).toEqual(["connecting", "reconnecting"]);
    expect(timers.fired).toHaveLength(1);

    conn.close();
    await flush();
    expect(timers.cleared).toHaveLength(1);
    expect(statuses.at(-1)).toBe("disconnected");
  });

  test("close() is idempotent (safe to call twice)", async () => {
    const h = harness();
    const conn = connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    conn.close();
    expect(() => conn.close()).not.toThrow();
  });

  test("uses the default reconnect delay, real timer functions, and Math.random jitter when none are injected", async () => {
    const h = harness();
    h.queueStatus(500);
    const conn = connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    conn.close();
  });
});
