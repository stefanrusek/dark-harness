import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobResultLine, LogHeader, LogLine } from "../contracts/index.ts";
import { buildSessionSummary, writeSessionSummary } from "./summary.ts";

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

function jobResult(overrides: Partial<JobResultLine> = {}): JobResultLine {
  return {
    version: 1,
    type: "job_result",
    timestamp: "2026-07-15T00:00:20.000Z",
    success: true,
    exitCode: 0,
    reportedBy: "clean-end",
    turns: 3,
    finalOutput: "all done",
    ...overrides,
  };
}

describe("buildSessionSummary", () => {
  test("derives cost, duration, and agent count from the session's log directory", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-summary-"));
    writeJsonl(join(dir, "root.jsonl"), [
      header({ agentId: "root", spawnedAt: "2026-07-15T00:00:00.000Z" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:05.000Z",
        type: "token_usage",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
      },
      { version: 1, timestamp: "2026-07-15T00:00:10.000Z", type: "completed", success: true },
    ]);
    writeJsonl(join(dir, "sub.jsonl"), [
      header({ agentId: "sub", parentAgentId: "root", spawnedAt: "2026-07-15T00:00:01.000Z" }),
      {
        version: 1,
        timestamp: "2026-07-15T00:00:04.000Z",
        type: "token_usage",
        inputTokens: 2,
        outputTokens: 1,
        costUsd: 0.02,
      },
      { version: 1, timestamp: "2026-07-15T00:00:06.000Z", type: "completed", success: true },
    ]);

    const summary = buildSessionSummary("s1", dir, jobResult());

    expect(summary).toEqual({
      version: 1,
      sessionId: "s1",
      timestamp: "2026-07-15T00:00:20.000Z",
      success: true,
      exitCode: 0,
      reportedBy: "clean-end",
      turns: 3,
      costUsd: 0.03,
      // 2026-07-15T00:00:20.000Z minus the earliest spawnedAt (root's, 00:00:00.000Z).
      durationMs: 20000,
      agentCount: 2,
    });
  });

  test("omits costUsd/durationMs when the log directory has nothing to derive them from", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-summary-"));
    // No .jsonl files at all — a real run always writes at least the root's header, but this
    // proves the summary degrades gracefully instead of throwing or fabricating zeros.
    const summary = buildSessionSummary("s1", dir, jobResult());
    expect(summary.costUsd).toBeUndefined();
    expect(summary.durationMs).toBeUndefined();
    expect(summary.agentCount).toBe(0);
  });

  test("carries a failed run's reportedBy/exitCode/outcome through unchanged", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-summary-"));
    writeJsonl(join(dir, "root.jsonl"), [header()]);
    const summary = buildSessionSummary(
      "s1",
      dir,
      jobResult({
        success: false,
        exitCode: 1,
        reportedBy: "tool",
        outcome: { status: "failure", summary: "hit a wall" },
      }),
    );
    expect(summary.success).toBe(false);
    expect(summary.exitCode).toBe(1);
    expect(summary.reportedBy).toBe("tool");
    expect(summary.outcome).toEqual({ status: "failure", summary: "hit a wall" });
  });
});

describe("writeSessionSummary", () => {
  test("writes a pretty-printed summary.json into the log directory", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-summary-"));
    const summary = buildSessionSummary("s1", dir, jobResult());
    writeSessionSummary(dir, summary);
    const written = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    expect(written).toEqual(summary);
  });
});
