import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogHeader, LogLine } from "../contracts/index.ts";
import { ResumeError, loadResumeSession } from "./resume.ts";

let logsRoot: string | undefined;

afterEach(() => {
  if (logsRoot) rmSync(logsRoot, { recursive: true, force: true });
  logsRoot = undefined;
});

function header(overrides: Partial<LogHeader> = {}): LogHeader {
  return {
    type: "header",
    version: 1,
    sessionId: "s1",
    agentId: "agent-root",
    parentAgentId: null,
    spawnedAt: "2026-07-15T00:00:00.000Z",
    model: "sonnet",
    instructionsSummary: "do a thing",
    client: "none",
    build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
    ...overrides,
  };
}

function writeRootJsonl(sessionId: string, lines: LogLine[]): void {
  // biome-ignore lint/style/noNonNullAssertion: set by every test before this is called
  const dir = join(logsRoot!, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "agent-root.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

function newLogsRoot(): string {
  logsRoot = mkdtempSync(join(tmpdir(), "dh-logs-resume-"));
  return logsRoot;
}

describe("loadResumeSession — failure modes (D6)", () => {
  test("missing session directory", () => {
    const root = newLogsRoot();
    expect(() => loadResumeSession(root, "nope")).toThrow(/session directory not found/);
  });

  test("headerless root log (empty file)", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", []);
    expect(() => loadResumeSession(root, "s1")).toThrow(/not a valid dh session directory/);
  });

  test("root log with garbage first line (no parseable header)", () => {
    const root = newLogsRoot();
    const dir = join(root, "s1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "agent-root.jsonl"), "not json at all\n");
    expect(() => loadResumeSession(root, "s1")).toThrow(/not a valid dh session directory/);
  });

  test("unsupported header version", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header({ version: 2 as unknown as 1 })]);
    expect(() => loadResumeSession(root, "s1")).toThrow(/unsupported log format/);
  });

  test("header sessionId mismatch", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header({ sessionId: "different" })]);
    expect(() => loadResumeSession(root, "s1")).toThrow(/inconsistent/);
  });

  test("broken resume chain: missing ancestor", () => {
    const root = newLogsRoot();
    writeRootJsonl("s2", [header({ sessionId: "s2", resumedFrom: { sessionId: "s1-missing" } })]);
    expect(() => loadResumeSession(root, "s2")).toThrow(/resume chain for "s2" is broken/);
  });

  test("cyclic resume chain", () => {
    const root = newLogsRoot();
    writeRootJsonl("a", [header({ sessionId: "a", resumedFrom: { sessionId: "b" } })]);
    writeRootJsonl("b", [header({ sessionId: "b", resumedFrom: { sessionId: "a" } })]);
    expect(() => loadResumeSession(root, "a")).toThrow(/cyclic/);
  });

  test("every failure mode throws a ResumeError instance", () => {
    const root = newLogsRoot();
    try {
      loadResumeSession(root, "nope");
      throw new Error("expected loadResumeSession to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeError);
    }
  });
});

describe("loadResumeSession — tolerated-not-fatal cases", () => {
  test("a corrupt/truncated event line is skipped, not fatal", () => {
    const root = newLogsRoot();
    const dir = join(root, "s1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "agent-root.jsonl"),
      `${JSON.stringify(header())}\n${JSON.stringify({
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "hello",
      })}\n{"trunc`,
    );
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
  });

  test("a header-only session (no replayable events) resumes with empty history", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header()]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([]);
    expect(result.model).toBe("sonnet");
    expect(result.resumedFromSessionId).toBe("s1");
  });

  test("missing sub-agent log files don't affect lostAgents (just yield nothing for them)", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header()]);
    // No sub-agent files at all in the directory — readSessionLogSummaries only sees agent-root.
    const result = loadResumeSession(root, "s1");
    expect(result.lostAgents).toEqual([]);
  });
});

describe("loadResumeSession — fold rules (D1)", () => {
  test("plain user/assistant text turns replay in order", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "do the thing",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "message",
        role: "assistant",
        content: "sure, done",
      },
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "do the thing" }] },
      { role: "assistant", content: [{ type: "text", text: "sure, done" }] },
    ]);
  });

  test("system-role message lines are skipped entirely", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "hi",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "message",
        role: "system",
        content: "Session budget exceeded: stopping.",
      },
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  test("an assistant turn with tool calls but no text opens its own assistant message", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "run ls",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "tool_call",
        toolName: "Bash",
        toolUseId: "t1",
        input: { command: "ls" },
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:03.000Z",
        type: "tool_result",
        toolUseId: "t1",
        output: "file.txt",
        isError: false,
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:04.000Z",
        type: "message",
        role: "assistant",
        content: "found file.txt",
      },
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "run ls" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "file.txt", isError: false }],
      },
      { role: "assistant", content: [{ type: "text", text: "found file.txt" }] },
    ]);
  });

  test("a non-string tool_result output is stringified defensively", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "tool_call",
        toolName: "Weird",
        toolUseId: "t1",
        input: {},
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "tool_result",
        toolUseId: "t1",
        output: { odd: true },
        isError: false,
      },
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Weird", input: {} }] },
      {
        role: "user",
        content: [
          { type: "tool_result", toolUseId: "t1", content: '{"odd":true}', isError: false },
        ],
      },
    ]);
  });

  test("a dangling tool_use (crash mid-tool) gets a synthesized error tool_result", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "tool_call",
        toolName: "Bash",
        toolUseId: "t-dangling",
        input: { command: "sleep 100" },
      },
      // No matching tool_result — the process crashed mid-execution.
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t-dangling", name: "Bash", input: { command: "sleep 100" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "t-dangling",
            content:
              "[dh: interrupted — the harness restarted before this tool call completed; its outcome is unknown]",
            isError: true,
          },
        ],
      },
    ]);
  });

  test("token_usage/status_change/completed/failed lines are not replayed as conversation content", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header(),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "hi",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "token_usage",
        inputTokens: 5,
        outputTokens: 5,
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:03.000Z",
        type: "status_change",
        status: "waiting",
      },
      { version: 1, timestamp: "2026-07-15T00:00:04.000Z", type: "completed", success: true },
    ]);
    const result = loadResumeSession(root, "s1");
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });
});

describe("loadResumeSession — resume chains (a session resumed more than once)", () => {
  test("walks resumedFrom oldest -> newest and concatenates replayed history", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [
      header({ sessionId: "s1" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "message",
        role: "user",
        content: "first session's instruction",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "message",
        role: "assistant",
        content: "working on it",
      },
    ]);
    writeRootJsonl("s2", [
      header({ sessionId: "s2", resumedFrom: { sessionId: "s1" } }),
      {
        version: 1,
        timestamp: "2026-07-15T01:00:00.000Z",
        type: "message",
        role: "user",
        content: "resume notice for s2",
      },
      {
        version: 1,
        timestamp: "2026-07-15T01:00:01.000Z",
        type: "message",
        role: "assistant",
        content: "continuing",
      },
    ]);
    const result = loadResumeSession(root, "s2");
    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "first session's instruction" }] },
      { role: "assistant", content: [{ type: "text", text: "working on it" }] },
      { role: "user", content: [{ type: "text", text: "resume notice for s2" }] },
      { role: "assistant", content: [{ type: "text", text: "continuing" }] },
    ]);
    expect(result.resumedFromSessionId).toBe("s2");
  });

  test("a chain longer than the cap is rejected as corrupt", () => {
    const root = newLogsRoot();
    // Build 101 non-cyclic hops: s0 (oldest, no resumedFrom) <- s1 <- ... <- s100.
    writeRootJsonl("s0", [header({ sessionId: "s0" })]);
    for (let i = 1; i <= 100; i += 1) {
      writeRootJsonl(`s${i}`, [
        header({ sessionId: `s${i}`, resumedFrom: { sessionId: `s${i - 1}` } }),
      ]);
    }
    expect(() => loadResumeSession(root, "s100")).toThrow(/exceeds 100 hops/);
  });
});

describe("loadResumeSession — model + lostAgents metadata", () => {
  test("model is the last (requested) hop's header model alias", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header({ sessionId: "s1", model: "old-model" })]);
    writeRootJsonl("s2", [
      header({ sessionId: "s2", model: "new-model", resumedFrom: { sessionId: "s1" } }),
    ]);
    const result = loadResumeSession(root, "s2");
    expect(result.model).toBe("new-model");
  });

  test("lostAgents lists non-terminal sub-agents from the requested session's directory only", () => {
    const root = newLogsRoot();
    writeRootJsonl("s1", [header({ sessionId: "s1" })]);
    const dir = join(root, "s1");
    writeFileSync(
      join(dir, `${encodeURIComponent("agent-child-1")}.jsonl`),
      `${JSON.stringify(
        header({
          sessionId: "s1",
          agentId: "agent-child-1",
          parentAgentId: "agent-root",
          description: "running sub-task",
        }),
      )}\n`,
    );
    writeFileSync(
      join(dir, `${encodeURIComponent("agent-child-2")}.jsonl`),
      `${JSON.stringify(header({ sessionId: "s1", agentId: "agent-child-2", parentAgentId: "agent-root" }))}\n${JSON.stringify(
        { version: 1, timestamp: "2026-07-15T00:00:01.000Z", type: "completed", success: true },
      )}\n`,
    );
    const result = loadResumeSession(root, "s1");
    expect(result.lostAgents).toHaveLength(1);
    expect(result.lostAgents[0]?.agentId).toBe("agent-child-1");
    expect(result.lostAgents[0]?.description).toBe("running sub-task");
    expect(result.lostAgents[0]?.status).toBe("running");
  });
});
