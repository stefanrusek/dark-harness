import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent, ServerSentEvent } from "../contracts/index.ts";
import { EVENTS_PATH, runSseClient } from "./sse-client.ts";
import type { ConnectionStatus } from "./types.ts";

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

describe("runSseClient", () => {
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

    await runSseClient({
      baseUrl: "http://localhost:4000",
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(events).toEqual([first, second]);
    expect(statuses).toEqual(["connecting", "open", "closed"]);
  });

  test("requests the events path with an SSE accept header", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const controller = new AbortController();
    const fetchImpl = asFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      controller.abort();
      return streamResponse([]);
    });

    await runSseClient({
      baseUrl: "http://localhost:4000",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      delayImpl: noDelay,
    });

    expect(capturedUrl).toBe(`http://localhost:4000${EVENTS_PATH}`);
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

    await runSseClient({
      baseUrl: "http://x",
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
    await runSseClient({
      baseUrl: "http://x",
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      delayImpl: noDelay,
    });

    expect(events).toHaveLength(1);
    expect(seenLastEventIds).toEqual([null, "5"]);
  });

  test("reconnects after a non-ok HTTP response, reporting an error status", async () => {
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

    await runSseClient({
      baseUrl: "http://x",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses).toEqual(["connecting", "error", "connecting", "open", "closed"]);
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

    await runSseClient({
      baseUrl: "http://x",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses).toEqual(["connecting", "error", "connecting", "open", "closed"]);
  });

  test("does not attempt to connect at all when the signal starts aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const fetchImpl = asFetch(async () => {
      called = true;
      return streamResponse([]);
    });

    await runSseClient({
      baseUrl: "http://x",
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

    await runSseClient({
      baseUrl: "http://x",
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

    await runSseClient({
      baseUrl: "http://x",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      onConnectionChange: (status) => statuses.push(status),
      delayImpl: noDelay,
    });

    expect(statuses[1]).toBe("error");
  });

  test("does nothing when the signal starts aborted, without a delayImpl or fetchImpl", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSseClient({ baseUrl: "http://x", signal: controller.signal, onEvent: () => {} }),
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
    await runSseClient({
      baseUrl: "http://x",
      fetchImpl,
      signal: controller.signal,
      onEvent: () => {},
      reconnectDelayMs: 1,
    });

    expect(call).toBe(2);
  });
});
