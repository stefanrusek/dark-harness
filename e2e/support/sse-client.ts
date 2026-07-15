// A tiny, e2e-local SSE client for GET /api/events (ADR 0002 wire format: `id: <id>\ndata:
// <json>\n\n` records, per src/server/sse.ts's `formatSseEvent`). Deliberately independent of
// `src/tui/sse-parser.ts` / `src/web/client/sse.ts` — this is a black-box test of the real
// wire protocol across an actual process boundary (docs/handoffs/e2e.md scope item 5), not a
// reuse of the client domains' own parsing code.

import type { ServerSentEvent } from "../../src/contracts/index.ts";

export interface SseTestClient {
  events: ServerSentEvent[];
  /** Resolves once `predicate` matches an already-received or future event, or rejects on
   * timeout. */
  waitFor(
    predicate: (event: ServerSentEvent) => boolean,
    timeoutMs?: number,
  ): Promise<ServerSentEvent>;
  close(): void;
}

export async function connectSse(
  baseUrl: string,
  options: { token?: string; lastEventId?: string } = {},
): Promise<SseTestClient> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.lastEventId) headers["Last-Event-ID"] = options.lastEventId;

  const controller = new AbortController();
  const response = await fetch(new URL("/api/events", baseUrl), {
    headers,
    signal: controller.signal,
  });
  if (response.status !== 200 || !response.body) {
    const client: SseTestClient = {
      events: [],
      waitFor: () => Promise.reject(new Error(`SSE connect failed: HTTP ${response.status}`)),
      close: () => controller.abort(),
    };
    // Surface the failed status to callers that want to assert on it directly.
    (client as SseTestClient & { status: number }).status = response.status;
    return client;
  }

  const events: ServerSentEvent[] = [];
  const waiters: {
    predicate: (event: ServerSentEvent) => boolean;
    resolve: (event: ServerSentEvent) => void;
  }[] = [];

  function pushEvent(event: ServerSentEvent): void {
    events.push(event);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (waiter?.predicate(event)) {
        waiters.splice(i, 1);
        waiter.resolve(event);
      }
    }
  }

  void (async () => {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const record = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const dataLine = record.split("\n").find((line) => line.startsWith("data: "));
          if (dataLine) {
            try {
              pushEvent(JSON.parse(dataLine.slice("data: ".length)) as ServerSentEvent);
            } catch {
              // Ignore malformed records (e.g. the leading ": connected" comment).
            }
          }
          separatorIndex = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Stream aborted/closed; nothing to do.
    }
  })();

  return {
    events,
    waitFor(predicate, timeoutMs = 10_000) {
      const already = events.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise<ServerSentEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === wrapped);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(
            new Error(
              `timed out after ${timeoutMs}ms waiting for an SSE event. Received so far: ${JSON.stringify(
                events.map((e) => e.type),
              )}`,
            ),
          );
        }, timeoutMs);
        const wrapped = (event: ServerSentEvent) => {
          clearTimeout(timer);
          resolve(event);
        };
        waiters.push({ predicate, resolve: wrapped });
      });
    },
    close: () => controller.abort(),
  };
}
