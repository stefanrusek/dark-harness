import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOutputEvent, AgentTreeNode, SessionEndedEvent } from "../contracts/index.ts";
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
