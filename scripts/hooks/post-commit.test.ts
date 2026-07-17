import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK_PATH = join(import.meta.dir, "post-commit");

async function run(cwd: string, cmd: string[], env?: Record<string, string>) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function initRepo(dir: string) {
  await run(dir, ["git", "init", "-q"]);
  await run(dir, ["git", "config", "user.email", "test@example.com"]);
  await run(dir, ["git", "config", "user.name", "Test"]);
  await run(dir, ["git", "config", "commit.gpgsign", "false"]);
}

async function installHook(dir: string) {
  await run(dir, ["mkdir", "-p", ".git/hooks"]);
  await run(dir, ["cp", HOOK_PATH, ".git/hooks/post-commit"]);
  await run(dir, ["chmod", "+x", ".git/hooks/post-commit"]);
}

async function commit(dir: string, message: string, env?: Record<string, string>) {
  await run(dir, ["sh", "-c", "date +%s%N > file.txt"]);
  await run(dir, ["git", "add", "-A"]);
  return run(dir, ["git", "commit", "-q", "-m", message], env);
}

async function commitN(
  dir: string,
  count: number,
  messagePrefix: string,
  env?: Record<string, string>,
) {
  let result = await commit(dir, `${messagePrefix} 0`, env);
  for (let i = 1; i < count; i++) {
    result = await commit(dir, `${messagePrefix} ${i}`, env);
  }
  return result;
}

let repoDir: string;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "dh-post-commit-test-"));
  await initRepo(repoDir);
  await installHook(repoDir);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("scripts/hooks/post-commit", () => {
  test("stays silent below threshold (zero-sentinel case)", async () => {
    const env = { DH_REFACTOR_THRESHOLD: "15" };
    const result = await commitN(repoDir, 5, "commit", env);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("fires the banner once the zero-sentinel count meets threshold", async () => {
    const env = { DH_REFACTOR_THRESHOLD: "3" };
    const result = await commitN(repoDir, 3, "commit", env);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("REFACTORING ROUND DUE");
    expect(result.stderr).toContain(
      "3 commits since the last Refactoring-Round trailer (threshold: 3)",
    );
    expect(result.stderr).toContain("docs/design/refactoring-round-prompt.md");
    expect(result.stderr).toContain("Refactoring-Round: DH-XXXX");
  });

  test("commit still succeeds even when the banner fires (advisory only)", async () => {
    const env = { DH_REFACTOR_THRESHOLD: "1" };
    const result = await commit(repoDir, "commit 0", env);
    expect(result.exitCode).toBe(0);
  });

  test("resets the counter after a Refactoring-Round trailer commit", async () => {
    const env = { DH_REFACTOR_THRESHOLD: "2" };
    await commit(repoDir, "commit 0", env);
    const trailerResult = await commit(repoDir, "Round close\n\nRefactoring-Round: DH-9999", env);
    expect(trailerResult.stderr).toBe("");

    const afterFirst = await commit(repoDir, "commit after reset 1", env);
    expect(afterFirst.stderr).toBe("");

    const afterSecond = await commit(repoDir, "commit after reset 2", env);
    expect(afterSecond.stderr).toContain("REFACTORING ROUND DUE");
    expect(afterSecond.stderr).toContain(
      "2 commits since the last Refactoring-Round trailer (threshold: 2)",
    );
  });

  test("threshold defaults to 15 when DH_REFACTOR_THRESHOLD is unset", async () => {
    const result = await commitN(repoDir, 15, "commit");
    expect(result.stderr).toContain("REFACTORING ROUND DUE");
    expect(result.stderr).toContain("threshold: 15");
  });

  test("a burst that jumps past threshold in one commit still fires correctly", async () => {
    // Simulate several worktree merges landing as separate commits in one
    // batch -- the count should reflect distance-from-sentinel exactly,
    // not a fixed -15 window.
    const env = { DH_REFACTOR_THRESHOLD: "5" };
    const result = await commitN(repoDir, 8, "commit", env);
    expect(result.stderr).toContain(
      "8 commits since the last Refactoring-Round trailer (threshold: 5)",
    );
  });
});
