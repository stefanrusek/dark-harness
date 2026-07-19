import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent, ServerSentEvent } from "../contracts/index.ts";
import type { ConnectionStatus } from "./connection-status.ts";
import { runSseTransport } from "./sse-transport.ts";

// DH-0184: single shared reconnect-driver test suite for the TUI and Web clients, extracted
// from src/tui/sse-client.test.ts (this exact suite, generalized from `baseUrl` to a full
// `url`) — src/web/client/sse.test.ts covered the same reconnect/backoff/Last-Event-ID
// behavior against an independently-arrived-at implementation.
function asFetch(
  fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

function outputEvent(overrides: Partial<AgentOutputEvent> = {}): AgentOutputEvent {
  return {
    version: 1,
    id: "1",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "root",
    chunk: "hi",
    ...overrides,
  };
}

function sseFrame(event: ServerSentEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function noDelay(): Promise<void> {
  return Promise.resolve();
}

describe("runSseTransport", () => {
  test("emits parsed events from a single-connection stream and stops at signal abort", async () => {
    const events: ServerSentEvent[] = [];
    const statuses: ConnectionStatus[] = [];
    const controller = new AbortController();
    const first = outputEvent({ id: "1", chunk: "a" });
    const second = outputEvent({ id: "2", chunk: "b" });

    const fetchImpl = asFetch(async () => {
      // Abort right after this connection closes so the reconnect loop exits cleanly.
      controller.abort();
      return streamResponse([sseFrame(first), sseFrame(second)]);
    });

    await runSseTransport({
      url: "http://localhost:4000/api/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(events).toEqual([first, second]);
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "disconnected"]);
  });

  test("requests the given URL with an SSE accept header", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const controller = new AbortController();
    const fetchImpl = asFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://localhost:4000/api/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      delayImpl: noDelay,
    });

    expect(capturedUrl).toBe("http://localhost:4000/api/events");
    expect(capturedHeaders?.accept).toBe("text/event-stream");
    expect(capturedHeaders?.["Last-Event-ID"]).toBeUndefined();
  });

  test("merges custom headers into the request", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const controller = new AbortController();
    const fetchImpl = asFetch(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      headers: { authorization: "Bearer t" },
      signal: controller.signal,
      onEvent: () => {},
      delayImpl: noDelay,
    });

    expect(capturedHeaders?.authorization).toBe("Bearer t");
  });

  test("reconnects with Last-Event-ID after the stream ends, replaying from the last seen id", async () => {
    const controller = new AbortController();
    const seenLastEventIds: (string | null)[] = [];
    let call = 0;

    const fetchImpl = asFetch(async (_url, init) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      seenLastEventIds.push(headers["Last-Event-ID"] ?? null);
      call += 1;
      if (call === 1) {
        return streamResponse([sseFrame(outputEvent({ id: "5", chunk: "first" }))]);
      }
      controller.abort();
      return streamResponse([]);
    });

    const events: ServerSentEvent[] = [];
    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      delayImpl: noDelay,
    });

    expect(events).toHaveLength(1);
    expect(seenLastEventIds).toEqual([null, "5"]);
  });

  test("reconnects after a non-ok HTTP response, reporting a reconnecting status", async () => {
    const controller = new AbortController();
    const statuses: ConnectionStatus[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) {
        return new Response(null, { status: 500 });
      }
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses).toEqual([
      "connecting",
      "reconnecting",
      "connecting",
      "live",
      "reconnecting",
      "disconnected",
    ]);
  });

  test("reconnects after fetch itself throws", async () => {
    const controller = new AbortController();
    const statuses: ConnectionStatus[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) throw new Error("network down");
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses).toEqual([
      "connecting",
      "reconnecting",
      "connecting",
      "live",
      "reconnecting",
      "disconnected",
    ]);
  });

  test("does not attempt to connect at all when the signal starts aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const fetchImpl = asFetch(async () => {
      called = true;
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      delayImpl: noDelay,
    });

    expect(called).toBe(false);
  });

  test("surfaces malformed frames via onParseError instead of onEvent", async () => {
    const controller = new AbortController();
    const parseErrors: string[] = [];
    const events: ServerSentEvent[] = [];
    const fetchImpl = asFetch(async () => {
      controller.abort();
      return streamResponse(["data: {not json\n\n"]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      onParseError: (raw) => parseErrors.push(raw),
      delayImpl: noDelay,
    });

    expect(events).toEqual([]);
    expect(parseErrors).toEqual(["{not json"]);
  });

  test("a response with no body is treated as a connection failure", async () => {
    const controller = new AbortController();
    const statuses: ConnectionStatus[] = [];
    let call = 0;
    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) {
        // Response with a null body but ok status.
        return new Response(null, { status: 200 });
      }
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses[1]).toBe("reconnecting");
  });

  test("does nothing when the signal starts aborted, without a delayImpl or fetchImpl", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSseTransport({ url: "http://x/events", signal: controller.signal, onEvent: () => {} }),
    ).resolves.toBeUndefined();
  });

  test("uses the real default reconnect delay between attempts", async () => {
    const controller = new AbortController();
    let call = 0;
    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) return streamResponse([]);
      controller.abort();
      return streamResponse([]);
    });

    // No delayImpl override: exercises the real setTimeout-based default delay function,
    // kept short via reconnectDelayMs so the test stays fast.
    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1,
    });

    expect(call).toBe(2);
  });

  test("backs off with growing delay on repeated failures (DH-0024)", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call <= 3) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1000,
      randomImpl: () => 1, // full jitter at its max — makes the cap directly observable
      delayImpl: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(delays).toEqual([1000, 2000, 4000]);
  });

  test("backoff delay never exceeds the cap even after many consecutive failures", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call <= 8) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1000,
      randomImpl: () => 1,
      delayImpl: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(Math.max(...delays)).toBe(30_000);
    expect(delays.every((ms) => ms <= 30_000)).toBe(true);
  });

  test("respects a custom maxReconnectDelayMs cap", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call <= 5) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 5000,
      randomImpl: () => 1,
      delayImpl: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(Math.max(...delays)).toBe(5000);
  });

  test("jitter scales the delay down when randomImpl returns less than 1", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1000,
      randomImpl: () => 0.25,
      delayImpl: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(delays).toEqual([250]);
  });

  test("does not call onReconnected for the first, successful connection of the session", async () => {
    const controller = new AbortController();
    let reconnectedCalls = 0;
    const fetchImpl = asFetch(async () => {
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onReconnected: () => {
        reconnectedCalls += 1;
      },
      delayImpl: noDelay,
    });

    expect(reconnectedCalls).toBe(0);
  });

  test("calls onReconnected once a connection succeeds after one or more failures", async () => {
    const controller = new AbortController();
    let reconnectedCalls = 0;
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onReconnected: () => {
        reconnectedCalls += 1;
      },
      delayImpl: noDelay,
    });

    expect(reconnectedCalls).toBe(1);
  });

  test("a second successful reconnect after a further failure calls onReconnected again", async () => {
    const controller = new AbortController();
    let reconnectedCalls = 0;
    let call = 0;

    const fetchImpl = asFetch(async () => {
      call += 1;
      // Fail, succeed-then-close (clean), fail again, succeed and stop.
      if (call === 1) return new Response(null, { status: 500 });
      if (call === 2) return streamResponse([]);
      if (call === 3) return new Response(null, { status: 500 });
      controller.abort();
      return streamResponse([]);
    });

    await runSseTransport({
      url: "http://x/events",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onReconnected: () => {
        reconnectedCalls += 1;
      },
      delayImpl: noDelay,
    });

    expect(reconnectedCalls).toBe(2);
  });
});
