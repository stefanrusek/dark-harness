import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogHeader, LogLine } from "../contracts/index.ts";
import {
  buildAgentLogTree,
  formatSessionList,
  formatSessionLogTree,
  listSessionDirectories,
  readAgentLogLines,
  readSessionLogSummaries,
} from "./log-analysis.ts";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function header(overrides: Partial<LogHeader> = {}): LogHeader {
  return {
    type: "header",
    version: 1,
    sessionId: "s1",
    agentId: "root",
    parentAgentId: null,
    spawnedAt: "2026-07-15T00:00:00.000Z",
    model: "claude",
    instructionsSummary: "do a thing",
    client: "none",
    build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
    ...overrides,
  };
}

function writeJsonl(path: string, lines: LogLine[]): void {
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

describe("readSessionLogSummaries / formatSessionLogTree", () => {
  test("throws a clear error for an unreadable session directory", () => {
    expect(() => readSessionLogSummaries(join(tmpdir(), "dh-logs-nope-xyz"))).toThrow(
      /cannot read session log directory/,
    );
  });

  test("reports no agent log files found", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    expect(formatSessionLogTree(dir)).toBe(`(no agent log files found in ${dir})`);
  });

  test("ignores non-.jsonl files and files with no valid header", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeFileSync(join(dir, "notes.txt"), "irrelevant");
    writeFileSync(join(dir, "empty.jsonl"), "");
    writeFileSync(join(dir, "garbage.jsonl"), "{not json\n");
    writeFileSync(join(dir, "no-header.jsonl"), `${JSON.stringify({ foo: "bar" })}\n`);
    expect(readSessionLogSummaries(dir)).toEqual([]);
  });

  test("summarizes a single agent: status from completed, cumulative cost, duration", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [
      header({ description: "root task" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:05.000Z",
        type: "token_usage",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:10.000Z",
        type: "token_usage",
        inputTokens: 20,
        outputTokens: 15,
        costUsd: 0.02,
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:12.000Z",
        type: "completed",
        success: true,
      },
    ]);
    const summaries = readSessionLogSummaries(dir);
    expect(summaries).toEqual([
      {
        agentId: "root",
        parentAgentId: null,
        description: "root task",
        model: "claude",
        spawnedAt: "2026-07-15T00:00:00.000Z",
        status: "done",
        costUsd: 0.03,
        durationMs: 12000,
      },
    ]);
  });

  test("status_change and failed lines set status; token_usage without costUsd doesn't set a cost", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "a.jsonl"), [
      header({ agentId: "a" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:01.000Z",
        type: "status_change",
        status: "waiting",
      },
      {
        version: 1,
        timestamp: "2026-07-15T00:00:02.000Z",
        type: "token_usage",
        inputTokens: 1,
        outputTokens: 1,
      },
      { version: 1, timestamp: "2026-07-15T00:00:03.000Z", type: "failed", reason: "boom" },
    ]);
    const [summary] = readSessionLogSummaries(dir);
    expect(summary?.status).toBe("failed");
    expect(summary?.costUsd).toBeUndefined();
  });

  test("an agent with only a header (no event lines) has no durationMs and status 'running'", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "only-header.jsonl"), [header({ agentId: "lonely" })]);
    const [summary] = readSessionLogSummaries(dir);
    expect(summary?.status).toBe("running");
    expect(summary?.durationMs).toBe(0);
  });

  test("buildAgentLogTree nests by parentAgentId and treats orphans as roots", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [header({ agentId: "root", parentAgentId: null })]);
    writeJsonl(join(dir, "child.jsonl"), [header({ agentId: "child", parentAgentId: "root" })]);
    writeJsonl(join(dir, "orphan.jsonl"), [
      header({ agentId: "orphan", parentAgentId: "missing-parent" }),
    ]);
    const tree = buildAgentLogTree(readSessionLogSummaries(dir));
    const byId = new Map(tree.map((n) => [n.agentId, n]));
    expect(byId.has("root")).toBe(true);
    expect(byId.has("orphan")).toBe(true);
    expect(byId.get("root")?.children.map((c) => c.agentId)).toEqual(["child"]);
  });

  test("formatSessionLogTree renders a multi-agent tree with cost/duration/status", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [
      header({ agentId: "root", parentAgentId: null }),
      { version: 1, timestamp: "2026-07-15T00:00:01.000Z", type: "completed", success: true },
    ]);
    writeJsonl(join(dir, "child1.jsonl"), [
      header({ agentId: "child1", parentAgentId: "root", description: "worker" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:00.500Z",
        type: "token_usage",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.005,
      },
    ]);
    writeJsonl(join(dir, "child2.jsonl"), [
      header({ agentId: "child2", parentAgentId: "root" }),
      { version: 1, timestamp: "2026-07-15T00:00:00.001Z", type: "failed", reason: "oops" },
    ]);
    const output = formatSessionLogTree(dir);
    expect(output).toContain("root");
    expect(output).toContain("[done]");
    expect(output).toContain("child1 (worker)");
    expect(output).toContain("cost=$0.0050");
    expect(output).toContain("child2");
    expect(output).toContain("[failed]");
    expect(output).toContain("1ms");
    expect(output.split("\n").length).toBe(3);
  });

  // DH-0067: the literal string "cost=$?" read as an unexpanded shell variable, not a
  // deliberate "unknown" marker.
  test("an agent with no costUsd renders 'cost=—', never the literal 'cost=$?'", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [header({ agentId: "root" })]);
    const output = formatSessionLogTree(dir);
    expect(output).toContain("cost=—");
    expect(output).not.toContain("$?");
  });

  // DH-0067: `dh logs` reads static JSONL files after the fact — it can't confirm a
  // "running" agent is actually still alive (a crashed/killed session leaves no terminal
  // status line behind). The tool qualifies that specific status rather than asserting a
  // fact it can't verify.
  test("qualifies a 'running' status as unconfirmed (no terminal event) — other statuses unqualified", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [header({ agentId: "root" })]);
    const output = formatSessionLogTree(dir);
    expect(output).toContain("[running (no terminal event seen)]");
  });

  test("color: true wraps the status word in ANSI codes; color: false (default) stays plain", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, "root.jsonl"), [
      header({ agentId: "root" }),
      { version: 1, timestamp: "2026-07-15T00:00:01.000Z", type: "completed", success: true },
    ]);
    const plain = formatSessionLogTree(dir);
    expect(plain).not.toContain("\x1b[");
    const colored = formatSessionLogTree(dir, { color: true });
    expect(colored).toContain("\x1b[32mdone\x1b[0m");
  });
});

describe("listSessionDirectories / formatSessionList (DH-0067)", () => {
  test("throws a clear error when the logs root itself can't be listed", () => {
    expect(() => listSessionDirectories(join(tmpdir(), "dh-logs-root-nope-xyz"))).toThrow(
      /cannot read logs directory/,
    );
    expect(formatSessionList.bind(null, join(tmpdir(), "dh-logs-root-nope-xyz"))).toThrow(
      /cannot read logs directory/,
    );
  });

  test("reports no sessions found for an empty logs root", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-root-"));
    expect(formatSessionList(dir)).toBe(`(no sessions found under ${dir})`);
  });

  test("lists sessions newest-first by earliest header spawnedAt, agentCount from valid files, ignores non-directories", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-root-"));
    writeFileSync(join(dir, "not-a-dir.txt"), "ignore me"); // must be skipped, not listed as a session

    mkdirSync(join(dir, "older-session"));
    writeJsonl(join(dir, "older-session", "root.jsonl"), [
      header({ agentId: "root", spawnedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    mkdirSync(join(dir, "newer-session"));
    writeJsonl(join(dir, "newer-session", "root.jsonl"), [
      header({ agentId: "root", spawnedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    writeJsonl(join(dir, "newer-session", "child.jsonl"), [
      header({ agentId: "child", parentAgentId: "root", spawnedAt: "2026-06-01T00:00:05.000Z" }),
    ]);

    mkdirSync(join(dir, "empty-session")); // no valid agent log files — startedAt undefined

    const sessions = listSessionDirectories(dir);
    expect(sessions).toEqual([
      { sessionId: "newer-session", startedAt: "2026-06-01T00:00:00.000Z", agentCount: 2 },
      { sessionId: "older-session", startedAt: "2026-01-01T00:00:00.000Z", agentCount: 1 },
      { sessionId: "empty-session", agentCount: 0 },
    ]);

    const listing = formatSessionList(dir);
    const lines = listing.split("\n");
    expect(lines[0]).toBe("newer-session  started=2026-06-01T00:00:00.000Z  agents=2");
    expect(lines[2]).toBe("empty-session  started=?  agents=0");
  });
});

describe("readAgentLogLines (DH-0038)", () => {
  test("returns [] for a missing file rather than throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    expect(readAgentLogLines(dir, "agent-root")).toEqual([]);
  });

  test("reads an agent's file by percent-encoded agentId, matching SessionLogger.filePathFor", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    writeJsonl(join(dir, `${encodeURIComponent("agent-root")}.jsonl`), [
      header({ agentId: "agent-root" }),
      { version: 1, timestamp: "2026-07-15T00:00:01.000Z", type: "completed", success: true },
    ]);
    const lines = readAgentLogLines(dir, "agent-root");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.type).toBe("header");
    expect(lines[1]?.type).toBe("completed");
  });

  test("tolerates a corrupt/truncated final line, keeping every earlier valid one", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-analysis-"));
    const path = join(dir, "agent-root.jsonl");
    writeFileSync(path, `${JSON.stringify(header({ agentId: "agent-root" }))}\n{"trunc`);
    const lines = readAgentLogLines(dir, "agent-root");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe("header");
  });
});
