import { describe, expect, test } from "bun:test";
import type { ServerTarget } from "../protocol.ts";
import {
  type ConnectEventsOptions,
  connectEvents,
  parseEventPayload,
  SseStreamParser,
} from "./sse.ts";
import type { ConnectionStatus } from "./state.ts";

/** A controllable fake SSE byte stream, plus the request init `fetchImpl` was called with. */
function fakeStream(): {
  body: ReadableStream<Uint8Array>;
  push(event: { id: string; type: string; [k: string]: unknown }): void;
  pushRaw(text: string): void;
  close(): void;
  error(err?: unknown): void;
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
    pushRaw(text) {
      controller?.enqueue(encoder.encode(text));
    },
    close() {
      controller?.close();
    },
    error(err) {
      controller?.error(err ?? new Error("stream error"));
    },
  };
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * A fetch double that hands out one `fakeStream()` per call (queued, FIFO) and records every
 * call's URL/headers. `respond` controls what the *next* call resolves/rejects with.
 */
function harness(): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
  streams: ReturnType<typeof fakeStream>[];
  queueStatus(status: number): void;
  queueReject(err: unknown): void;
} {
  const calls: FetchCall[] = [];
  const streams: ReturnType<typeof fakeStream>[] = [];
  type QueuedResponse =
    | { kind: "ok" }
    | { kind: "status"; status: number }
    | { kind: "reject"; err: unknown };
  const queue: QueuedResponse[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { kind: "ok" as const };
    if (next.kind === "reject") throw next.err;
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
    queueReject: (err: unknown) => queue.push({ kind: "reject", err }),
  };
}

const target: ServerTarget = { baseUrl: "http://localhost:4000" };

function immediateTimers(): Pick<ConnectEventsOptions, "setTimeoutImpl" | "clearTimeoutImpl"> & {
  fired: Array<() => void>;
  fireNext(): void;
} {
  const fired: Array<() => void> = [];
  const setTimeoutImpl = ((fn: () => void) => {
    fired.push(fn);
    return fired.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutImpl = (() => {}) as typeof clearTimeout;
  return {
    setTimeoutImpl,
    clearTimeoutImpl,
    fired,
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

  test("reports connecting synchronously, then open once the response arrives", async () => {
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

  test("parses events split across multiple stream chunks and forwards them in order", async () => {
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

  test("ignores a record with a malformed data payload instead of throwing", async () => {
    const h = harness();
    const events: unknown[] = [];
    connectEvents(
      target,
      { onEvent: (e) => events.push(e), onStatusChange: () => {} },
      { fetchImpl: h.fetchImpl },
    );
    await flush();
    h.streams[0]?.pushRaw("id: bad-1\ndata: not json\n\n");
    await flush();
    expect(events).toHaveLength(0);
  });

  test("a non-OK response schedules a reconnect (status reconnecting) without throwing", async () => {
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
  });

  test("a rejected fetch (network error) schedules a reconnect", async () => {
    const h = harness();
    const timers = immediateTimers();
    h.queueReject(new TypeError("network down"));
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
  });

  test("a mid-stream read error schedules a reconnect", async () => {
    const h = harness();
    const timers = immediateTimers();
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
    h.streams[0]?.error(new Error("boom"));
    await flush();
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
  });

  test("a clean stream close (server ends the response) schedules a reconnect", async () => {
    const h = harness();
    const timers = immediateTimers();
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
    h.streams[0]?.close();
    await flush();
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
  });

  test("reconnecting after a drop resends Last-Event-ID from the highest id seen", async () => {
    const h = harness();
    const timers = immediateTimers();
    connectEvents(
      target,
      { onEvent: () => {}, onStatusChange: () => {} },
      {
        fetchImpl: h.fetchImpl,
        setTimeoutImpl: timers.setTimeoutImpl,
        clearTimeoutImpl: timers.clearTimeoutImpl,
      },
    );
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
    expect(h.calls).toHaveLength(2);
    const headers = new Headers(h.calls[1]?.init?.headers);
    expect(headers.get("Last-Event-ID")).toBe("e7");
  });

  test("close() aborts the in-flight request, reports closed, and does not schedule a reconnect", async () => {
    const h = harness();
    const timers = immediateTimers();
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
    conn.close();
    await flush();
    expect(statuses.at(-1)).toBe("disconnected");
    expect(timers.fired).toHaveLength(0);
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

  test("uses the default reconnect delay and real timer functions when none are injected", async () => {
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

describe("SseStreamParser", () => {
  test("parses a single push containing multiple complete records", () => {
    const parser = new SseStreamParser();
    const records = parser.push("id: a\ndata: {}\n\nid: b\ndata: {}\n\n");
    expect(records).toEqual([
      { id: "a", data: "{}" },
      { id: "b", data: "{}" },
    ]);
  });

  test("buffers a partial record across push() calls", () => {
    const parser = new SseStreamParser();
    expect(parser.push('id: a\ndata: {"x":')).toEqual([]);
    expect(parser.push("1}\n\n")).toEqual([{ id: "a", data: '{"x":1}' }]);
  });

  test("ignores comment lines (server's leading `: connected` keep-alive)", () => {
    const parser = new SseStreamParser();
    const records = parser.push(": connected\n\nid: a\ndata: {}\n\n");
    expect(records).toEqual([
      { id: undefined, data: undefined },
      { id: "a", data: "{}" },
    ]);
  });

  test("joins multiple data: lines in one record with a newline", () => {
    const parser = new SseStreamParser();
    const records = parser.push("id: a\ndata: line one\ndata: line two\n\n");
    expect(records).toEqual([{ id: "a", data: "line one\nline two" }]);
  });

  test("strips a trailing \\r so CRLF-terminated streams parse the same as LF", () => {
    const parser = new SseStreamParser();
    const records = parser.push("id: a\r\ndata: {}\r\n\r\n");
    expect(records).toEqual([{ id: "a", data: "{}" }]);
  });
});

describe("parseEventPayload", () => {
  test("returns null for non-string input", () => {
    expect(parseEventPayload(undefined)).toBeNull();
  });

  test("returns null for JSON that isn't an object with a type field", () => {
    expect(parseEventPayload(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(parseEventPayload(JSON.stringify({ noType: true }))).toBeNull();
  });

  test("returns the parsed event for a well-formed payload", () => {
    const original = {
      version: 1,
      id: "e1",
      timestamp: "2026-01-01T00:00:00Z",
      type: "session_ended",
      exitCode: 0,
    } as const;
    const parsed = parseEventPayload(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });
});
