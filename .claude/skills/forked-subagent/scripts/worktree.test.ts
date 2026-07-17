import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupWorktree, createWorktree, defaultWorktreePath } from "./worktree.ts";

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`${cmd.join(" ")} failed: ${err}`);
  }
  return out;
}

async function makeTestRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "dh0114-repo-"));
  await run(["git", "init", "-q", "-b", "main"], dir);
  await run(["git", "config", "user.email", "test@example.com"], dir);
  await run(["git", "config", "user.name", "Test"], dir);
  await Bun.write(path.join(dir, "README.md"), "hello\n");
  await run(["git", "add", "README.md"], dir);
  await run(["git", "commit", "-q", "-m", "init"], dir);
  return dir;
}

const cleanupDirs: string[] = [];

describe("defaultWorktreePath", () => {
  test("places worktree as a sibling of the repo, named <repo>-worktrees/<branch>", () => {
    const p = defaultWorktreePath("/some/path/my-repo", "DH-0001-thing");
    expect(p).toBe(path.resolve("/some/path/my-repo-worktrees/DH-0001-thing"));
  });
});

describe("createWorktree / cleanupWorktree (integration — real git worktree in a scratch repo)", () => {
  test("creates a worktree on a new branch and the branch/files are isolated from the main repo", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const worktreePath = await createWorktree({ repo, branch: "feature-a" });
    cleanupDirs.push(worktreePath);

    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(path.join(worktreePath, "README.md"))).toBe(true);

    // Write a file only inside the worktree — proves filesystem isolation from the main repo.
    await Bun.write(path.join(worktreePath, "only-in-worktree.txt"), "isolated\n");
    expect(existsSync(path.join(repo, "only-in-worktree.txt"))).toBe(false);
  });

  test("reuses an existing worktree for the same branch instead of erroring", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const first = await createWorktree({ repo, branch: "feature-b" });
    cleanupDirs.push(first);
    const second = await createWorktree({ repo, branch: "feature-b" });

    expect(second).toBe(first);
  });

  test("leaves a dirty (uncommitted changes) worktree in place on cleanup", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const worktreePath = await createWorktree({ repo, branch: "feature-c" });
    cleanupDirs.push(worktreePath);
    appendFileSync(path.join(worktreePath, "README.md"), "dirty change\n");

    const outcome = await cleanupWorktree({ repo, worktreePath, branch: "feature-c" });

    expect(outcome.removed).toBe(false);
    expect(outcome.reason).toContain("uncommitted");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("leaves an unmerged (but clean) worktree in place on cleanup", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const worktreePath = await createWorktree({ repo, branch: "feature-d" });
    cleanupDirs.push(worktreePath);
    await Bun.write(path.join(worktreePath, "new-file.txt"), "content\n");
    await run(["git", "add", "new-file.txt"], worktreePath);
    await run(["git", "commit", "-q", "-m", "add new-file"], worktreePath);

    const outcome = await cleanupWorktree({ repo, worktreePath, branch: "feature-d" });

    expect(outcome.removed).toBe(false);
    expect(outcome.reason).toContain("not merged");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("removes a clean, merged worktree and its branch on cleanup", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const worktreePath = await createWorktree({ repo, branch: "feature-e" });
    await Bun.write(path.join(worktreePath, "new-file.txt"), "content\n");
    await run(["git", "add", "new-file.txt"], worktreePath);
    await run(["git", "commit", "-q", "-m", "add new-file"], worktreePath);
    await run(["git", "merge", "-q", "feature-e"], repo);

    const outcome = await cleanupWorktree({ repo, worktreePath, branch: "feature-e" });

    expect(outcome.removed).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);
    const branches = await run(["git", "branch"], repo);
    expect(branches).not.toContain("feature-e");
  });

  test("force cleanup removes an unmerged/dirty worktree without inspection", async () => {
    const repo = await makeTestRepo();
    cleanupDirs.push(repo);

    const worktreePath = await createWorktree({ repo, branch: "feature-f" });
    appendFileSync(path.join(worktreePath, "README.md"), "dirty\n");

    const outcome = await cleanupWorktree({ repo, worktreePath, branch: "feature-f", force: true });

    expect(outcome.removed).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);
  });
});

afterAll(async () => {
  // Best-effort scratch cleanup — these are real tmpdir git repos/worktrees created above.
  for (const dir of cleanupDirs) {
    try {
      await Bun.spawn(["rm", "-rf", dir]).exited;
    } catch {
      // ignore
    }
  }
});
