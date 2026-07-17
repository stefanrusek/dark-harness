#!/usr/bin/env bun
/**
 * Create/reuse and clean up a `git worktree` for forked sub-agent dispatch.
 *
 * Usage:
 *   bun worktree.ts create --repo <repoPath> --branch <name> [--base <ref>] [--path <dir>]
 *   bun worktree.ts cleanup --repo <repoPath> --path <dir> --branch <name> [--force] [--keep-branch]
 *
 * `create` prints the worktree's absolute path to stdout (and nothing else), so it's easy to
 * capture: `WT=$(bun worktree.ts create --repo . --branch DH-0114-thing)`.
 *
 * `cleanup` follows the same discipline as the Workflow tool's `isolation: "worktree"` mode:
 * remove the worktree if it has no uncommitted changes and its branch is fully merged into
 * the base it was created from; otherwise leave it in place for inspection and print why.
 * Pass --force to remove regardless (e.g. known-failed run you don't need to inspect).
 */
import { existsSync } from "node:fs";
import path from "node:path";

async function run(
  cmd: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export function defaultWorktreePath(repo: string, branch: string): string {
  // Sibling directory next to the repo, named <repo-basename>-worktrees/<branch>, so
  // worktrees never live inside the repo itself (which git worktree disallows anyway for
  // nested paths without extra flags) and are easy to find/clean up in bulk.
  const repoName = path.basename(path.resolve(repo));
  return path.join(path.resolve(repo), "..", `${repoName}-worktrees`, branch);
}

export async function createWorktree(opts: {
  repo: string;
  branch: string;
  base?: string;
  worktreePath?: string;
}): Promise<string> {
  const repo = path.resolve(opts.repo);
  const worktreePath = path.resolve(opts.worktreePath ?? defaultWorktreePath(repo, opts.branch));

  if (existsSync(worktreePath)) {
    // Reuse: confirm it's actually a worktree of this repo and on the expected branch.
    const list = await run(["git", "worktree", "list", "--porcelain"], repo);
    if (!list.stdout.includes(worktreePath)) {
      throw new Error(
        `${worktreePath} already exists but is not a registered worktree of ${repo}. Refusing to reuse.`,
      );
    }
    return worktreePath;
  }

  // Does the branch already exist? If so, attach the new worktree to it rather than -b'ing
  // a duplicate (git would refuse anyway).
  const branchCheck = await run(["git", "rev-parse", "--verify", "--quiet", opts.branch], repo);
  const branchExists = branchCheck.code === 0;

  const args = branchExists
    ? ["worktree", "add", worktreePath, opts.branch]
    : ["worktree", "add", "-b", opts.branch, worktreePath, opts.base ?? "HEAD"];

  const result = await run(["git", ...args], repo);
  if (result.code !== 0) {
    throw new Error(`git worktree add failed: ${result.stderr.trim()}`);
  }
  return worktreePath;
}

export type CleanupOutcome = { removed: true; reason: string } | { removed: false; reason: string };

export async function cleanupWorktree(opts: {
  repo: string;
  worktreePath: string;
  branch: string;
  base?: string;
  force?: boolean;
  keepBranch?: boolean;
}): Promise<CleanupOutcome> {
  const repo = path.resolve(opts.repo);
  const worktreePath = path.resolve(opts.worktreePath);

  if (!existsSync(worktreePath)) {
    return { removed: false, reason: `${worktreePath} does not exist; nothing to clean up.` };
  }

  if (!opts.force) {
    const status = await run(["git", "status", "--porcelain"], worktreePath);
    if (status.stdout.trim().length > 0) {
      return {
        removed: false,
        reason: "worktree has uncommitted changes; left in place for inspection.",
      };
    }

    const base = opts.base ?? "HEAD";
    const merged = await run(["git", "branch", "--merged", base], repo);
    const mergedBranches = merged.stdout
      .split("\n")
      // `git branch --merged` prefixes the current branch with "*" and any branch checked
      // out in another worktree with "+" — strip either before matching.
      .map((l) => l.replace(/^[*+]?\s+/, "").trim())
      .filter(Boolean);
    if (!mergedBranches.includes(opts.branch)) {
      return {
        removed: false,
        reason: `branch '${opts.branch}' is not merged into '${base}'; left in place for inspection.`,
      };
    }
  }

  const removeArgs = opts.force
    ? ["worktree", "remove", "--force", worktreePath]
    : ["worktree", "remove", worktreePath];
  const remove = await run(["git", ...removeArgs], repo);
  if (remove.code !== 0) {
    return { removed: false, reason: `git worktree remove failed: ${remove.stderr.trim()}` };
  }

  if (!opts.keepBranch) {
    await run(["git", "branch", "-D", opts.branch], repo);
  }

  return { removed: true, reason: opts.force ? "force-removed." : "clean and merged; removed." };
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (sub === "create") {
    const worktreePath = await createWorktree({
      repo: String(flags.repo ?? "."),
      branch: String(flags.branch),
      base: flags.base ? String(flags.base) : undefined,
      worktreePath: flags.path ? String(flags.path) : undefined,
    });
    console.log(worktreePath);
  } else if (sub === "cleanup") {
    const outcome = await cleanupWorktree({
      repo: String(flags.repo ?? "."),
      worktreePath: String(flags.path),
      branch: String(flags.branch),
      base: flags.base ? String(flags.base) : undefined,
      force: Boolean(flags.force),
      keepBranch: Boolean(flags["keep-branch"]),
    });
    console.log(JSON.stringify(outcome));
    if (!outcome.removed && !flags.force) process.exitCode = 0; // leaving in place is a valid, non-error outcome
  } else {
    console.error("Usage: worktree.ts <create|cleanup> [flags]");
    process.exit(2);
  }
}
