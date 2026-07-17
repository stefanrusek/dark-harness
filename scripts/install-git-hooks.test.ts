import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL_SCRIPT_PATH = join(import.meta.dir, "install-git-hooks.sh");
const HOOK_SOURCE_PATH = join(import.meta.dir, "hooks", "post-commit");

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
  await run(dir, ["sh", "-c", "echo hi > file.txt"]);
  await run(dir, ["git", "add", "-A"]);
  await run(dir, ["git", "commit", "-q", "-m", "initial"]);
}

// Copy install-git-hooks.sh and its hooks/ directory into a fresh repo so
// the script's own path-resolution logic (relative to $0) is exercised
// against that repo, not this checkout.
function stageInstaller(dir: string) {
  Bun.write(join(dir, "scripts", "install-git-hooks.sh"), readFileSync(INSTALL_SCRIPT_PATH));
  Bun.write(join(dir, "scripts", "hooks", "post-commit"), readFileSync(HOOK_SOURCE_PATH));
}

let repoDir: string;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "dh-install-hooks-test-"));
  await initRepo(repoDir);
  stageInstaller(repoDir);
  await run(repoDir, ["chmod", "+x", "scripts/install-git-hooks.sh", "scripts/hooks/post-commit"]);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("scripts/install-git-hooks.sh", () => {
  test("copies post-commit into .git/hooks and makes it executable", async () => {
    const result = await run(repoDir, ["sh", "scripts/install-git-hooks.sh"]);
    expect(result.exitCode).toBe(0);

    const installedPath = join(repoDir, ".git", "hooks", "post-commit");
    expect(existsSync(installedPath)).toBe(true);

    const mode = statSync(installedPath).mode;
    expect(mode & 0o111).not.toBe(0);

    const installedContent = readFileSync(installedPath, "utf8");
    const sourceContent = readFileSync(HOOK_SOURCE_PATH, "utf8");
    expect(installedContent).toBe(sourceContent);
  });

  test("copies the file rather than symlinking it", async () => {
    await run(repoDir, ["sh", "scripts/install-git-hooks.sh"]);
    const installedPath = join(repoDir, ".git", "hooks", "post-commit");
    const lstat = statSync(installedPath);
    expect(lstat.isSymbolicLink()).toBe(false);
  });

  test("refuses to run (no-op, exit 0) inside a linked worktree", async () => {
    const worktreeDir = join(tmpdir(), `dh-worktree-${Date.now()}`);
    const addResult = await run(repoDir, [
      "git",
      "worktree",
      "add",
      "-q",
      "-b",
      "wt-branch",
      worktreeDir,
    ]);
    expect(addResult.exitCode).toBe(0);

    try {
      stageInstaller(worktreeDir);
      await run(worktreeDir, [
        "chmod",
        "+x",
        "scripts/install-git-hooks.sh",
        "scripts/hooks/post-commit",
      ]);

      const result = await run(worktreeDir, ["sh", "scripts/install-git-hooks.sh"]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr.toLowerCase()).toContain("worktree");
      expect(existsSync(join(worktreeDir, ".git", "hooks", "post-commit"))).toBe(false);
      // Main checkout's real hooks dir must also be untouched by the worktree run.
      expect(existsSync(join(repoDir, ".git", "hooks", "post-commit"))).toBe(false);
    } finally {
      await run(repoDir, ["git", "worktree", "remove", "-f", worktreeDir]);
    }
  });

  test("installed hook actually fires on commit in the main checkout", async () => {
    await run(repoDir, ["sh", "scripts/install-git-hooks.sh"]);
    await run(repoDir, ["sh", "-c", "echo more > file.txt"]);
    await run(repoDir, ["git", "add", "-A"]);
    const result = await run(repoDir, ["git", "commit", "-q", "-m", "second"], {
      DH_REFACTOR_THRESHOLD: "1",
    });
    expect(result.stderr).toContain("REFACTORING ROUND DUE");
  });
});
