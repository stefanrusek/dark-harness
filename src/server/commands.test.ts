import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTreeNode, LogMessageEvent } from "../contracts/index.ts";
import { handleCommand } from "./commands.ts";
import { FakeAgentLoop } from "./fake-agent-loop.ts";
import { SessionLogger } from "./logger.ts";

const tree: AgentTreeNode[] = [
  {
    agentId: "root",
    parentAgentId: null,
    model: "sonnet",
    status: "running",
    children: [
      {
        agentId: "child-1",
        parentAgentId: "root",
        model: "sonnet",
        status: "waiting",
        children: [],
      },
    ],
  },
];

function decodeText(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

describe("handleCommand", () => {
  let dir: string;
  let logger: SessionLogger;
  let loop: FakeAgentLoop;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dh-server-commands-"));
    logger = new SessionLogger(dir);
    loop = new FakeAgentLoop();
    loop.setAgentTree(tree);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = () => ({ agentLoop: loop, logger, sessionId: "session-1" });

  test("rejects a non-object body", () => {
    const result = handleCommand("not an object", ctx());
    expect(result).toEqual({
      kind: "json",
      status: 400,
      body: { ok: false, error: "invalid command body" },
    });
  });

  test("rejects null", () => {
    const result = handleCommand(null, ctx());
    expect(result.status).toBe(400);
  });

  test("rejects an unrecognized command type", () => {
    const result = handleCommand({ type: "levitate" }, ctx());
    expect(result).toEqual({
      kind: "json",
      status: 400,
      body: { ok: false, error: "invalid command body" },
    });
  });

  describe("send_message", () => {
    test("dispatches to the agent loop and acks for a known agent", () => {
      const result = handleCommand(
        { type: "send_message", agentId: "child-1", message: "hi" },
        ctx(),
      );
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.sentMessages).toEqual([{ agentId: "child-1", message: "hi" }]);
    });

    test("errors for an unknown agentId without touching the loop", () => {
      const result = handleCommand(
        { type: "send_message", agentId: "ghost", message: "hi" },
        ctx(),
      );
      expect(result).toEqual({
        kind: "json",
        status: 404,
        body: { ok: false, error: "unknown agentId: ghost" },
      });
      expect(loop.sentMessages).toEqual([]);
    });

    test("rejects a body missing agentId or message", () => {
      expect(handleCommand({ type: "send_message", agentId: "child-1" }, ctx()).status).toBe(400);
      expect(handleCommand({ type: "send_message", message: "hi" }, ctx()).status).toBe(400);
    });
  });

  describe("stop_agent", () => {
    test("dispatches to the agent loop and acks for a known agent", () => {
      const result = handleCommand({ type: "stop_agent", agentId: "root" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.stoppedAgents).toEqual(["root"]);
    });

    test("errors for an unknown agentId", () => {
      const result = handleCommand({ type: "stop_agent", agentId: "ghost" }, ctx());
      expect(result.status).toBe(404);
      expect(loop.stoppedAgents).toEqual([]);
    });

    test("rejects a body missing agentId", () => {
      expect(handleCommand({ type: "stop_agent" }, ctx()).status).toBe(400);
    });
  });

  describe("request_agent_tree", () => {
    test("returns the current tree snapshot", () => {
      const result = handleCommand({ type: "request_agent_tree" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true, tree } });
    });
  });

  describe("download_logs", () => {
    test("404s when a single agent has no log file yet", () => {
      const result = handleCommand({ type: "download_logs", agentId: "child-1" }, ctx());
      expect(result.status).toBe(404);
    });

    test("returns raw JSONL bytes for a single agent", () => {
      const message: LogMessageEvent = {
        version: 1,
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "message",
        role: "assistant",
        content: "hi",
      };
      logger.append("child-1", message);
      const result = handleCommand({ type: "download_logs", agentId: "child-1" }, ctx());
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("application/x-ndjson");
      expect(decodeText(result.body)).toBe(`${JSON.stringify(message)}\n`);
    });

    test("accepts an explicitly-undefined agentId the same as omitted (full bundle)", () => {
      const result = handleCommand({ type: "download_logs", agentId: undefined }, ctx());
      expect(result.kind).toBe("binary");
    });

    test("returns an empty tar bundle when no logs exist yet and the dir is otherwise present", () => {
      const result = handleCommand({ type: "download_logs" }, ctx());
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.contentType).toBe("application/x-tar");
      expect(result.filename).toBe("session-session-1.tar");
      expect(result.body.length).toBe(1024); // two trailing zero blocks, no entries
    });

    test("bundles every agent's log file into the tar archive", () => {
      logger.append("root", {
        version: 1,
        timestamp: "t",
        type: "message",
        role: "user",
        content: "a",
      });
      logger.append("child-1", {
        version: 1,
        timestamp: "t",
        type: "message",
        role: "user",
        content: "b",
      });
      const result = handleCommand({ type: "download_logs" }, ctx());
      if (result.kind !== "binary") throw new Error("expected binary result");
      // Two agent files plus a trailing zero-block region: bigger than a bare empty archive.
      expect(result.body.length).toBeGreaterThan(1024);
    });

    test("bundles logs from a freshly-constructed dir with no prior writes at all", () => {
      const freshDir = mkdtempSync(join(tmpdir(), "dh-server-commands-fresh-"));
      rmSync(freshDir, { recursive: true, force: true }); // logger creates it; simulate not-yet-created
      const freshLogger = new SessionLogger(freshDir);
      rmSync(freshDir, { recursive: true, force: true }); // now genuinely gone again
      const result = handleCommand(
        { type: "download_logs" },
        { agentLoop: loop, logger: freshLogger, sessionId: "session-2" },
      );
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.body.length).toBe(1024);
    });
  });
});
