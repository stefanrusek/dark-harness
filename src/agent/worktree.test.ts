import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktree,
  hasChanges,
  isGitRepo,
  removeWorktree,
  WorktreeError,
} from "./worktree.ts";

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dh-worktree-test-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

describe("worktree primitives (DH-0077)", () => {
  test("isGitRepo is true inside a real repo and false elsewhere", () => {
    const repo = makeGitRepo();
    expect(isGitRepo(repo)).toBe(true);
    const notARepo = mkdtempSync(join(tmpdir(), "dh-worktree-test-notrepo-"));
    expect(isGitRepo(notARepo)).toBe(false);
  });

  test("createWorktree creates a checkout on a new branch off the repo's HEAD", () => {
    const repo = makeGitRepo();
    const worktree = createWorktree(repo, "agent-wt-1");
    expect(worktree.branch).toBe("dh/agent-wt-1");
    expect(worktree.repoCwd).toBe(repo);
    const headInWorktree = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktree.path,
      encoding: "utf8",
    }).trim();
    expect(headInWorktree).toBe(worktree.baseSha);
  });

  test("hasChanges is false for an untouched fresh worktree", () => {
    const repo = makeGitRepo();
    const worktree = createWorktree(repo, "agent-wt-2");
    expect(hasChanges(worktree)).toBe(false);
  });

  test("hasChanges is true after an uncommitted edit in the worktree", () => {
    const repo = makeGitRepo();
    const worktree = createWorktree(repo, "agent-wt-3");
    writeFileSync(join(worktree.path, "scratch.txt"), "work in progress\n");
    expect(hasChanges(worktree)).toBe(true);
  });

  test("hasChanges is true after a commit in the worktree even with a clean working tree", () => {
    const repo = makeGitRepo();
    const worktree = createWorktree(repo, "agent-wt-4");
    writeFileSync(join(worktree.path, "scratch.txt"), "committed work\n");
    execFileSync("git", ["add", "scratch.txt"], { cwd: worktree.path });
    execFileSync("git", ["commit", "-q", "-m", "add scratch"], { cwd: worktree.path });
    expect(hasChanges(worktree)).toBe(true);
  });

  test("removeWorktree deletes the worktree and its branch", () => {
    const repo = makeGitRepo();
    const worktree = createWorktree(repo, "agent-wt-5");
    removeWorktree(worktree);
    const branches = execFileSync("git", ["branch", "--list", worktree.branch], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(branches).toBe("");
    const list = execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" });
    expect(list).not.toContain(worktree.path);
  });

  test("git failures surface as WorktreeError", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "dh-worktree-test-fail-"));
    expect(() => createWorktree(notARepo, "agent-wt-fail")).toThrow(WorktreeError);
  });
});
