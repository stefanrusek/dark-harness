import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktree, cleanupWorktree } from "./worktree.ts";
import { dispatch } from "./dispatch.ts";

// End-to-end integration test for Dark Harness ticket DH-0114 User Story 1: dispatch a real
// `claude` subprocess into a real, dedicated git worktree, and confirm the file it writes is
// physically confined to that worktree — not the shared checkout — regardless of what the
// sub-agent's prompt says. This is the scenario the ticket exists to fix (a confused
// in-process sub-agent writing outside its assigned directory).
//
// Real `git worktree` + real `claude` subprocess, no mocking (CLAUDE.md §9: mocking
// child_process here would test nothing). Not part of the `bun run test:coverage` gate; run
// on demand via `bun test .claude/skills/forked-subagent`.

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
  const dir = mkdtempSync(path.join(tmpdir(), "dh0114-e2e-repo-"));
  await run(["git", "init", "-q", "-b", "main"], dir);
  await run(["git", "config", "user.email", "test@example.com"], dir);
  await run(["git", "config", "user.name", "Test"], dir);
  await Bun.write(path.join(dir, "README.md"), "hello\n");
  await run(["git", "add", "README.md"], dir);
  await run(["git", "commit", "-q", "-m", "init"], dir);
  return dir;
}

const cleanupDirs: string[] = [];

describe("worktree-scoped dispatch (integration — real git worktree + real claude subprocess)", () => {
  test(
    "a file the sub-agent writes lands only in its dedicated worktree, never the shared repo checkout — " +
      "and its final report is collected back like an Agent-tool result",
    async () => {
      const repo = await makeTestRepo();
      cleanupDirs.push(repo);

      const branch = "dh0114-isolation-check";
      const worktreePath = await createWorktree({ repo, branch });
      cleanupDirs.push(worktreePath);

      const result = await dispatch({
        dir: worktreePath,
        prompt:
          "Create a file named isolated-proof.txt in the current directory containing the text: sealed. " +
          "Then commit it with git (add + commit -m 'add isolated-proof'). Reply with exactly: COMMITTED",
      });

      // Result is collected back the same way an Agent-tool call's result would be: a text
      // summary plus success/exit status, no manual log-tailing required.
      expect(result.success).toBe(true);
      expect(result.result).toContain("COMMITTED");

      // The core isolation guarantee: the file exists in the worktree, and NOT in the shared
      // repo checkout, regardless of what the sub-agent's prompt said.
      expect(existsSync(path.join(worktreePath, "isolated-proof.txt"))).toBe(true);
      expect(existsSync(path.join(repo, "isolated-proof.txt"))).toBe(false);

      // Cleanup discipline: unmerged branch is left in place for inspection, not silently
      // deleted, mirroring Workflow's isolation:"worktree" behavior.
      const unmergedOutcome = await cleanupWorktree({ repo, worktreePath, branch });
      expect(unmergedOutcome.removed).toBe(false);
      expect(existsSync(worktreePath)).toBe(true);

      // Once merged, cleanup removes the worktree.
      await run(["git", "merge", "-q", branch], repo);
      const mergedOutcome = await cleanupWorktree({ repo, worktreePath, branch });
      expect(mergedOutcome.removed).toBe(true);
      expect(existsSync(worktreePath)).toBe(false);
      expect(await Bun.file(path.join(repo, "isolated-proof.txt")).text()).toContain("sealed");
    },
    120_000,
  );
});

afterAll(async () => {
  for (const dir of cleanupDirs) {
    try {
      await Bun.spawn(["rm", "-rf", dir]).exited;
    } catch {
      // ignore
    }
  }
});
