import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentOutputEvent,
  AgentTreeNode,
  SessionEndedEvent,
  ToolCallEvent,
} from "../contracts/index.ts";
import { FakeAgentLoop } from "./fake-agent-loop.ts";
import { DhServer } from "./server.ts";

const CERT_PATH = join(import.meta.dir, "testdata", "test-cert.pem");
const KEY_PATH = join(import.meta.dir, "testdata", "test-key.pem");

function outputEvent(id: string, chunk = "hello"): AgentOutputEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "root",
    chunk,
  };
}

function toolCallEvent(id: string, inputSummary: string): ToolCallEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "tool_call",
    agentId: "root",
    toolUseId: id,
    toolName: "Bash",
    inputSummary,
  };
}

/** Reads SSE bytes off a Response body until `count` full "id:.../data:..." records have
 * been parsed, then cancels the stream. Returns the parsed events in arrival order. */
async function readSseEvents(response: Response, count: number): Promise<unknown[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const record = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = record.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) events.push(JSON.parse(dataLine.slice("data: ".length)));
      boundary = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
  return events;
}

/** Reads raw SSE records (including comment lines like `: ping`) off a Response body
 * until at least `count` records have been parsed, then cancels the stream. */
async function readSseRecords(response: Response, count: number): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  const records: string[] = [];
  while (records.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      records.push(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
  return records;
}

describe("DhServer", () => {
  let dir: string;
  let loop: FakeAgentLoop;
  let server: DhServer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dh-server-integration-"));
    loop = new FakeAgentLoop();
  });

  afterEach(() => {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("start() binds an ephemeral port and reports it consistently via the port getter", () => {
    server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
    const port = server.start();
    expect(port).toBeGreaterThan(0);
    expect(server.port).toBe(port);
    expect(server.protocol).toBe("http");
  });

  test("404s on unknown routes", async () => {
    server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
    const port = server.start();
    const res = await fetch(`http://localhost:${port}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("OPTIONS is answered with CORS headers and no auth required", async () => {
    server = new DhServer({
      agentLoop: loop,
      sessionId: "s1",
      logDir: dir,
      port: 0,
      security: { token: "secret-token" },
    });
    const port = server.start();
    const res = await fetch(`http://localhost:${port}/api/commands`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  describe("POST /api/commands", () => {
    test("handles request_agent_tree end to end", async () => {
      const tree: AgentTreeNode[] = [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ];
      loop.setAgentTree(tree);
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, tree });
    });

    test("handles send_message end to end", async () => {
      loop.setAgentTree([
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ]);
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "send_message", agentId: "root", message: "go" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(loop.sentMessages).toEqual([{ agentId: "root", message: "go" }]);
    });

    test("handles stop_agent end to end", async () => {
      loop.setAgentTree([
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ]);
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "stop_agent", agentId: "root" }),
      });
      expect(res.status).toBe(200);
      expect(loop.stoppedAgents).toEqual(["root"]);
    });

    test("handles download_logs (single agent) end to end with correct headers", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      loop.emitLog("root", {
        type: "header",
        version: 1,
        sessionId: "s1",
        agentId: "root",
        parentAgentId: null,
        spawnedAt: "2026-07-15T00:00:00.000Z",
        model: "sonnet",
        instructionsSummary: "do it",
        client: "none",
        build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
      });

      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "download_logs", agentId: "root" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-ndjson");
      expect(res.headers.get("content-disposition")).toContain("root.jsonl");
      const text = await res.text();
      expect(text).toContain('"sessionId":"s1"');
    });

    test("handles download_logs (full bundle) end to end with correct headers", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "download_logs" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-tar");
      expect(res.headers.get("content-disposition")).toContain("session-s1.tar");
    });

    test("400s on invalid JSON body", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: "{not json",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid JSON body" });
    });

    test("GET on the commands path is a 404, not a fallthrough", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, { method: "GET" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/events (SSE)", () => {
    test("streams live events pushed after connection", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      const res = await fetch(`http://localhost:${port}/api/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");

      const readPromise = readSseEvents(res, 2);
      loop.emitEvent(outputEvent("1", "a"));
      loop.emitEvent(outputEvent("2", "b"));
      const events = await readPromise;
      expect(events).toEqual([outputEvent("1", "a"), outputEvent("2", "b")]);
    });

    test("honors Last-Event-ID to replay buffered events on reconnect", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();

      // Populate the buffer before any SSE connection exists — DhServer subscribes
      // globally in start(), independent of any particular request.
      loop.emitEvent(outputEvent("1"));
      loop.emitEvent(outputEvent("2"));
      loop.emitEvent(outputEvent("3"));

      const res = await fetch(`http://localhost:${port}/api/events`, {
        headers: { "Last-Event-ID": "1" },
      });
      const events = await readSseEvents(res, 2);
      expect(events).toEqual([outputEvent("2"), outputEvent("3")]);
    });

    test("DH-0089: redacts a known secret in a tool_call event's inputSummary on the live broadcast path", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        knownSecrets: ["mysecretvalue123"],
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      const readPromise = readSseEvents(res, 1);
      loop.emitEvent(toolCallEvent("tc1", "curl -H mysecretvalue123"));
      const events = await readPromise;
      expect(events).toEqual([toolCallEvent("tc1", "curl -H [REDACTED:config-secret]")]);
    });

    test("DH-0089: redacts a known secret in a tool_call event's inputSummary on the buffered replay path", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        knownSecrets: ["mysecretvalue123"],
      });
      const port = server.start();
      loop.emitEvent(toolCallEvent("tc1", "curl -H mysecretvalue123"));

      const res = await fetch(`http://localhost:${port}/api/events`);
      const events = await readSseEvents(res, 1);
      expect(events).toEqual([toolCallEvent("tc1", "curl -H [REDACTED:config-secret]")]);
    });

    test("GET /api/events with no prior events and no live pushes returns an open, empty stream", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      expect(res.status).toBe(200);
      // Cancel immediately; nothing should have been buffered or delivered.
      await res.body?.cancel();
    });

    test("a session_ended event flows through the live stream too", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      const readPromise = readSseEvents(res, 1);
      const ended: SessionEndedEvent = {
        version: 1,
        id: "e1",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "session_ended",
        exitCode: 0,
      };
      loop.emitEvent(ended);
      expect(await readPromise).toEqual([ended]);
    });

    test("sends periodic `: ping` keep-alive comments on an open connection", async () => {
      // A tiny interval (not a real multi-second sleep) proves the timer actually fires
      // repeatedly, without slowing the suite down.
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        heartbeatIntervalMs: 5,
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      // First record is ": connected"; wait for at least two pings after it.
      const records = await readSseRecords(res, 3);
      expect(records[0]).toBe(": connected");
      expect(records[1]).toBe(": ping");
      expect(records[2]).toBe(": ping");
    });

    test("clears the heartbeat timer when the connection is cancelled", async () => {
      // Regression guard for a leaked timer: cancelling the stream and stopping the server
      // should not throw or hang the test process on a dangling interval.
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        heartbeatIntervalMs: 5,
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      await res.body?.cancel();
      // No leaked timer to observe directly here (Round 2 note), but if `clearInterval`
      // weren't called, a dangling `setInterval` would keep firing after cancel and keep
      // the bun test process's event loop alive past the suite's own end — the CI gate
      // failing to exit cleanly is the regression this guards against.
    });

    test("DH-0019: emits a resync event before replay when Last-Event-ID is unknown/evicted", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      loop.emitEvent(outputEvent("1"));
      loop.emitEvent(outputEvent("2"));

      const res = await fetch(`http://localhost:${port}/api/events`, {
        headers: { "Last-Event-ID": "never-seen" },
      });
      const events = (await readSseEvents(res, 3)) as Array<{ type: string }>;
      expect(events[0]?.type).toBe("resync");
      expect(events.slice(1)).toEqual([outputEvent("1"), outputEvent("2")]);
    });

    test("DH-0019: does not emit a resync event when Last-Event-ID is known or omitted", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      loop.emitEvent(outputEvent("1"));
      loop.emitEvent(outputEvent("2"));

      const known = await fetch(`http://localhost:${port}/api/events`, {
        headers: { "Last-Event-ID": "1" },
      });
      const knownEvents = (await readSseEvents(known, 1)) as Array<{ type: string }>;
      expect(knownEvents.map((e) => e.type)).not.toContain("resync");

      const fresh = await fetch(`http://localhost:${port}/api/events`);
      const readPromise = readSseEvents(fresh, 1);
      loop.emitEvent(outputEvent("3"));
      const freshEvents = (await readPromise) as Array<{ type: string }>;
      expect(freshEvents.map((e) => e.type)).not.toContain("resync");
    });

    test("DH-0019: closes an unresponsive connection instead of buffering unboundedly", async () => {
      // Going through a real HTTP round-trip (fetch to a bound port) doesn't reliably
      // exercise this path: Bun's transport keeps draining the response stream into the OS
      // socket buffer regardless of whether *this test* calls `reader.read()`, so
      // `controller.desiredSize` never actually goes negative for the tiny payloads used
      // here. Calling the server's private SSE handler directly gets the real
      // `ReadableStreamDefaultController` with no transport layer between it and this
      // test's reader.
      //
      // Note `reader.closed` alone doesn't prove closure either: per the streams spec,
      // `controller.close()` only stops future enqueues — a reader whose queue still has
      // unread chunks doesn't observe `closed` resolve until it actually drains them. So
      // this test lets the connection saturate and self-close *unread* first, then drains
      // it afterward and asserts draining terminates (`done: true`) after a bounded number
      // of chunks — proving both that the close happened and that growth was bounded, not
      // unbounded.
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        heartbeatIntervalMs: 1,
      });
      server.start();
      // Reaching a private method (and the private `bunServer` it now needs to disable
      // Bun's own idle timeout on the SSE connection, per DH-0058) deliberately, for the
      // reason explained above.
      const internals = server as unknown as {
        handleSse: (req: Request, bunServer: ReturnType<typeof Bun.serve>) => Response;
        bunServer: ReturnType<typeof Bun.serve>;
      };
      const handleSse = internals.handleSse.bind(server);
      const res: Response = handleSse(
        new Request("http://localhost/api/events"),
        internals.bunServer,
      );

      // Let the unread connection saturate past the backpressure threshold and self-close,
      // entirely without draining it.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const reader = res.body?.getReader();
      if (!reader) throw new Error("no response body");
      let count = 0;
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done) count++;
        // Bail out rather than hang the suite if this regresses to unbounded growth.
        if (count > 10_000) break;
      }
      expect(done).toBe(true);
      expect(count).toBeLessThan(10_000);
    });
  });

  describe("bearer token auth (ADR 0004)", () => {
    test("rejects POST without a token when one is configured", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { token: "s3cret" },
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "request_agent_tree" }),
      });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    });

    test("rejects GET /api/events without a token when one is configured", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { token: "s3cret" },
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/events`);
      expect(res.status).toBe(401);
    });

    test("accepts requests carrying the correct bearer token", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { token: "s3cret" },
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      });
      expect(res.status).toBe(200);
    });

    test("rejects requests carrying the wrong bearer token", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { token: "s3cret" },
      });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      });
      expect(res.status).toBe(401);
    });

    test("no token configured: requests pass with or without an Authorization header", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      const res = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "request_agent_tree" }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("TLS (ADR 0004)", () => {
    test("serves HTTPS on the configured cert/key and reports protocol 'https'", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { tls: { cert: CERT_PATH, key: KEY_PATH } },
      });
      const port = server.start();
      expect(server.protocol).toBe("https");

      const res = await fetch(`https://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "request_agent_tree" }),
        tls: { rejectUnauthorized: false },
      });
      expect(res.status).toBe(200);
    });

    test("TLS combined with a bearer token: both protections apply independently", async () => {
      server = new DhServer({
        agentLoop: loop,
        sessionId: "s1",
        logDir: dir,
        port: 0,
        security: { token: "s3cret", tls: { cert: CERT_PATH, key: KEY_PATH } },
      });
      const port = server.start();

      const unauthed = await fetch(`https://localhost:${port}/api/commands`, {
        method: "POST",
        body: JSON.stringify({ type: "request_agent_tree" }),
        tls: { rejectUnauthorized: false },
      });
      expect(unauthed.status).toBe(401);

      const authed = await fetch(`https://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
        body: JSON.stringify({ type: "request_agent_tree" }),
        tls: { rejectUnauthorized: false },
      });
      expect(authed.status).toBe(200);
    });
  });

  describe("JSONL logging side effect (ADR 0005)", () => {
    test("every onLog emission from the agent loop is durably appended to that agent's file", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      server.start();

      loop.emitLog("agent-a", {
        type: "header",
        version: 1,
        sessionId: "s1",
        agentId: "agent-a",
        parentAgentId: null,
        spawnedAt: "2026-07-15T00:00:00.000Z",
        model: "sonnet",
        instructionsSummary: "do it",
        client: "none",
        build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
      });
      loop.emitLog("agent-a", { version: 1, timestamp: "t", type: "completed", success: true });

      const content = readFileSync(join(dir, "agent-a.jsonl"), "utf8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] as string).type).toBe("header");
      expect(JSON.parse(lines[1] as string).type).toBe("completed");
    });
  });

  describe("stop()", () => {
    test("unsubscribes from the agent loop and closes the listener", async () => {
      server = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      const port = server.start();
      server.stop();
      await expect(fetch(`http://localhost:${port}/api/events`)).rejects.toThrow();

      // Further emissions after stop() must not throw even though the server unsubscribed.
      expect(() => loop.emitEvent(outputEvent("after-stop"))).not.toThrow();
      server = undefined as unknown as DhServer; // avoid double-stop in afterEach
    });

    test("stop() before start() is a safe no-op", () => {
      const fresh = new DhServer({ agentLoop: loop, sessionId: "s1", logDir: dir, port: 0 });
      expect(() => fresh.stop()).not.toThrow();
    });
  });
});
