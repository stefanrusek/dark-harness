import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTreeNode, LogMessageEvent } from "../contracts/index.ts";
import { handleCommand } from "./commands.ts";
import { FakeAgentLoop } from "./__fixtures__/fake-agent-loop.ts";
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

  test("rejects a non-object body", async () => {
    const result = await handleCommand("not an object", ctx());
    expect(result).toEqual({
      kind: "json",
      status: 400,
      body: { ok: false, error: "invalid command body" },
    });
  });

  test("rejects null", async () => {
    const result = await handleCommand(null, ctx());
    expect(result.status).toBe(400);
  });

  test("rejects an unrecognized command type", async () => {
    const result = await handleCommand({ type: "levitate" }, ctx());
    expect(result).toEqual({
      kind: "json",
      status: 400,
      body: { ok: false, error: "invalid command body" },
    });
  });

  describe("send_message", () => {
    test("dispatches to the agent loop and acks for a known agent", async () => {
      const result = await handleCommand(
        { type: "send_message", agentId: "child-1", message: "hi" },
        ctx(),
      );
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.sentMessages).toEqual([{ agentId: "child-1", message: "hi" }]);
    });

    test("errors for an unknown agentId without touching the loop", async () => {
      const result = await handleCommand(
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

    test("rejects a body missing agentId or message", async () => {
      expect(
        (await handleCommand({ type: "send_message", agentId: "child-1" }, ctx())).status,
      ).toBe(400);
      expect((await handleCommand({ type: "send_message", message: "hi" }, ctx())).status).toBe(
        400,
      );
    });
  });

  describe("stop_agent", () => {
    test("dispatches to the agent loop and acks for a known agent", async () => {
      const result = await handleCommand({ type: "stop_agent", agentId: "root" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.stoppedAgents).toEqual(["root"]);
    });

    test("errors for an unknown agentId", async () => {
      const result = await handleCommand({ type: "stop_agent", agentId: "ghost" }, ctx());
      expect(result.status).toBe(404);
      expect(loop.stoppedAgents).toEqual([]);
    });

    test("rejects a body missing agentId", async () => {
      expect((await handleCommand({ type: "stop_agent" }, ctx())).status).toBe(400);
    });
  });

  describe("request_agent_tree", () => {
    test("returns the current tree snapshot", async () => {
      const result = await handleCommand({ type: "request_agent_tree" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true, tree } });
    });
  });

  describe("download_logs", () => {
    test("404s when a single agent has no log file yet", async () => {
      const result = await handleCommand({ type: "download_logs", agentId: "child-1" }, ctx());
      expect(result.status).toBe(404);
    });

    test("returns raw JSONL bytes for a single agent", async () => {
      const message: LogMessageEvent = {
        version: 1,
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "message",
        role: "assistant",
        content: "hi",
      };
      logger.append("child-1", message);
      const result = await handleCommand({ type: "download_logs", agentId: "child-1" }, ctx());
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("application/x-ndjson");
      expect(decodeText(result.body)).toBe(`${JSON.stringify(message)}\n`);
    });

    test("accepts an explicitly-undefined agentId the same as omitted (full bundle)", async () => {
      const result = await handleCommand({ type: "download_logs", agentId: undefined }, ctx());
      expect(result.kind).toBe("binary");
    });

    test("returns an empty tar bundle when no logs exist yet and the dir is otherwise present", async () => {
      const result = await handleCommand({ type: "download_logs" }, ctx());
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.contentType).toBe("application/x-tar");
      expect(result.filename).toBe("session-session-1.tar");
      expect(result.body.length).toBe(1024); // two trailing zero blocks, no entries
    });

    test("bundles every agent's log file into the tar archive", async () => {
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
      const result = await handleCommand({ type: "download_logs" }, ctx());
      if (result.kind !== "binary") throw new Error("expected binary result");
      // Two agent files plus a trailing zero-block region: bigger than a bare empty archive.
      expect(result.body.length).toBeGreaterThan(1024);
    });

    test("bundles logs from a freshly-constructed dir with no prior writes at all", async () => {
      const freshDir = mkdtempSync(join(tmpdir(), "dh-server-commands-fresh-"));
      rmSync(freshDir, { recursive: true, force: true }); // logger creates it; simulate not-yet-created
      const freshLogger = new SessionLogger(freshDir);
      rmSync(freshDir, { recursive: true, force: true }); // now genuinely gone again
      const result = await handleCommand(
        { type: "download_logs" },
        { agentLoop: loop, logger: freshLogger, sessionId: "session-2" },
      );
      expect(result.kind).toBe("binary");
      if (result.kind !== "binary") throw new Error("expected binary result");
      expect(result.body.length).toBe(1024);
    });
  });

  // DH-0093: the four new slash-command-backend commands.
  describe("list_models", () => {
    test("returns the models list from the agent loop", async () => {
      const models = [
        {
          name: "sonnet",
          provider: "anthropic",
          model: "claude-sonnet",
          isDefault: true,
          isActive: true,
        },
      ];
      loop.setModels(models);
      const result = await handleCommand({ type: "list_models" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true, models } });
    });
  });

  describe("switch_model", () => {
    test("dispatches to the agent loop and acks", async () => {
      const result = await handleCommand(
        { type: "switch_model", agentId: "root", model: "haiku" },
        ctx(),
      );
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.switchedModels).toEqual([{ agentId: "root", model: "haiku" }]);
    });

    test("translates a thrown error (e.g. unknown model / non-root agentId) into a 400 ack", async () => {
      loop.switchModel = () => {
        throw new Error('unknown model "nope"');
      };
      const result = await handleCommand(
        { type: "switch_model", agentId: "root", model: "nope" },
        ctx(),
      );
      expect(result).toEqual({
        kind: "json",
        status: 400,
        body: { ok: false, error: 'unknown model "nope"' },
      });
    });

    test("rejects a body missing agentId or model", async () => {
      expect((await handleCommand({ type: "switch_model", agentId: "root" }, ctx())).status).toBe(
        400,
      );
      expect((await handleCommand({ type: "switch_model", model: "haiku" }, ctx())).status).toBe(
        400,
      );
    });
  });

  describe("list_skills", () => {
    test("returns the skills list from the agent loop", async () => {
      const skills = [{ name: "cli-tools", description: "Bundled CLI reference." }];
      loop.setSkills(skills);
      const result = await handleCommand({ type: "list_skills" }, ctx());
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true, skills } });
    });
  });

  describe("invoke_skill", () => {
    test("dispatches to the agent loop and acks", async () => {
      const result = await handleCommand(
        { type: "invoke_skill", agentId: "root", skill: "cli-tools", args: "--verbose" },
        ctx(),
      );
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.invokedSkills).toEqual([
        { agentId: "root", skill: "cli-tools", args: "--verbose" },
      ]);
    });

    test("works without args", async () => {
      const result = await handleCommand(
        { type: "invoke_skill", agentId: "root", skill: "cli-tools" },
        ctx(),
      );
      expect(result).toEqual({ kind: "json", status: 200, body: { ok: true } });
      expect(loop.invokedSkills).toEqual([
        { agentId: "root", skill: "cli-tools", args: undefined },
      ]);
    });

    test("translates a rejected/thrown unknown-skill error into a 404 ack", async () => {
      loop.invokeSkill = async () => {
        throw new Error('unknown skill "nope"');
      };
      const result = await handleCommand(
        { type: "invoke_skill", agentId: "root", skill: "nope" },
        ctx(),
      );
      expect(result).toEqual({
        kind: "json",
        status: 404,
        body: { ok: false, error: 'unknown skill "nope"' },
      });
    });

    test("rejects a body missing agentId or skill, or with a non-string args", async () => {
      expect(
        (await handleCommand({ type: "invoke_skill", skill: "cli-tools" }, ctx())).status,
      ).toBe(400);
      expect((await handleCommand({ type: "invoke_skill", agentId: "root" }, ctx())).status).toBe(
        400,
      );
      expect(
        (
          await handleCommand(
            { type: "invoke_skill", agentId: "root", skill: "cli-tools", args: 5 },
            ctx(),
          )
        ).status,
      ).toBe(400);
    });
  });
});
