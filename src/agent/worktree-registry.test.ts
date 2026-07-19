import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_CONCURRENT_WORKTREES, WorktreeRegistry } from "./worktree-registry.ts";
import { WorktreeError } from "./worktree.ts";

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dh-worktree-registry-test-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

describe("WorktreeRegistry (DH-0173)", () => {
  test("reserve() creates and registers a worktree, retrievable via get()", () => {
    const repo = makeGitRepo();
    const registry = new WorktreeRegistry();
    const worktree = registry.reserve("agent-1", repo, undefined);
    expect(registry.get("agent-1")).toBe(worktree);
  });

  test("reserve() refuses once the configured maxConcurrentAgents cap is reached", () => {
    const repo = makeGitRepo();
    const registry = new WorktreeRegistry();
    registry.reserve("agent-1", repo, 1);
    expect(() => registry.reserve("agent-2", repo, 1)).toThrow(
      /isolated worktree\(s\) already live/,
    );
    expect(() => registry.reserve("agent-2", repo, 1)).toThrow(
      /configured options.maxConcurrentAgents/,
    );
  });

  test("reserve() refuses at the default cap when maxConcurrentAgents is unset", () => {
    const repo = makeGitRepo();
    const registry = new WorktreeRegistry();
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT_WORKTREES; i++) {
      registry.reserve(`agent-${i}`, repo, undefined);
    }
    expect(() => registry.reserve("agent-overflow", repo, undefined)).toThrow(/default worktree/);
  });

  test("reserve() throws WorktreeError when the underlying git worktree creation fails", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "dh-worktree-registry-test-notrepo-"));
    const registry = new WorktreeRegistry();
    expect(() => registry.reserve("agent-1", notARepo, undefined)).toThrow(WorktreeError);
  });

  test("release() unregisters and returns the worktree, freeing budget for a new reserve()", () => {
    const repo = makeGitRepo();
    const registry = new WorktreeRegistry();
    registry.reserve("agent-1", repo, 1);
    const released = registry.release("agent-1");
    expect(released).toBeDefined();
    expect(registry.get("agent-1")).toBeUndefined();
    // Budget freed — a fresh reserve() at the same cap should now succeed.
    expect(() => registry.reserve("agent-2", repo, 1)).not.toThrow();
  });

  test("release() is a no-op returning undefined for an agent with no worktree", () => {
    const registry = new WorktreeRegistry();
    expect(registry.release("never-reserved")).toBeUndefined();
  });
});
