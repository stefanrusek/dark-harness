import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import type { AgentInfo } from "../types.ts";
import { StatusRow, detectGitInfo } from "./StatusRow.tsx";

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agentId: "root",
    parentAgentId: null,
    model: "claude-sonnet-5",
    status: "running",
    transcript: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    lastEventAt: 0,
    statusSince: 0,
    pendingToolCall: null,
    ...overrides,
  };
}

describe("detectGitInfo", () => {
  test("reports branch: null when the git command fails (not a repo, or no git on PATH)", () => {
    const info = detectGitInfo(() => {
      throw new Error("not a git repository");
    });
    expect(info.branch).toBeNull();
    expect(info.cwd).toBe(process.cwd());
  });

  test("reports the branch name the injected command returns when it succeeds", () => {
    const info = detectGitInfo(() => "main");
    expect(info.branch).toBe("main");
  });
});

describe("StatusRow", () => {
  test("with no agent yet, shows placeholder model/progress but real git info", () => {
    const { lastFrame } = render(
      React.createElement(StatusRow, {
        gitInfo: { branch: "main", cwd: "/repo" },
        now: 1000,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("main · /repo");
  });

  test("renders model name, running elapsed indicator, and branch+cwd", () => {
    const { lastFrame } = render(
      React.createElement(StatusRow, {
        agentState: agent({ model: "claude-sonnet-5", status: "running", statusSince: 0 }),
        gitInfo: { branch: "DH-0125-tui-status-row", cwd: "/Users/dev/dark-harness" },
        now: 5000,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("claude-sonnet-5");
    expect(frame).toContain("5s");
    expect(frame).toContain("DH-0125-tui-status-row · /Users/dev/dark-harness");
  });

  test("renders a terminal status word (not an elapsed timer) once the agent is done", () => {
    const { lastFrame } = render(
      React.createElement(StatusRow, {
        agentState: agent({ status: "done" }),
        gitInfo: { branch: "main", cwd: "/repo" },
        now: 5000,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("done");
  });

  test("falls back to a dim placeholder for the git location when not in a git repo", () => {
    const { lastFrame } = render(
      React.createElement(StatusRow, {
        gitInfo: { branch: null, cwd: "/tmp/scratch" },
        now: 1000,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/tmp/scratch");
  });
});
