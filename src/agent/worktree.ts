// Git worktree isolation primitives for DH-0077 (tracking/DH-0077-*.md) — the underlying
// mechanism behind the `Agent` tool's `isolation: "worktree"` param (tools/agent.ts). Kept
// as a standalone, synchronous (execFileSync) module so runtime.ts's `spawnAgent()` can stay
// fully synchronous itself (its existing maxAgentDepth/maxConcurrentAgents budget checks are
// synchronous throws surfaced by the Agent tool's try/catch — see agent.ts) rather than
// forcing every caller/test of spawnAgent to become async just for this one isolation mode.
// Git commands are fast/local so a blocking call here is an acceptable trade-off, matching
// the existing synchronous-throw precedent for the other spawn-time budget checks.

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  } catch (err) {
    const stderr = (err as { stderr?: string | Buffer }).stderr;
    const detail = stderr ? stderr.toString().trim() : (err as Error).message;
    throw new WorktreeError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/** True when `cwd` is inside a git working tree (any git repo, not necessarily its root). */
export function isGitRepo(cwd: string): boolean {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export interface CreatedWorktree {
  path: string;
  branch: string;
  /** HEAD sha the branch was cut from — `hasChanges()` compares against this to detect new
   * commits on the branch, in addition to uncommitted working-tree changes. */
  baseSha: string;
  /** The repo cwd the worktree was created from — needed by `removeWorktree()`, since `git
   * worktree remove`/`branch -D` must run from a checkout that still knows about this
   * worktree (the worktree's own directory is gone once removed). */
  repoCwd: string;
}

/** Creates a new git worktree, on a fresh branch, checked out from `repoCwd`'s current HEAD.
 * The worktree lives under the OS temp directory (never inside the repo itself), keyed by
 * `agentId` so it's trivially traceable back to the sub-agent that owns it. Throws
 * `WorktreeError` on any git failure. */
export function createWorktree(repoCwd: string, agentId: string): CreatedWorktree {
  const baseSha = git(["rev-parse", "HEAD"], repoCwd).trim();
  const branch = `dh/${agentId}`;
  const root = mkdtempSync(join(tmpdir(), "dh-worktrees-"));
  const path = join(root, agentId);
  git(["worktree", "add", "-b", branch, path, baseSha], repoCwd);
  return { path, branch, baseSha, repoCwd };
}

/** True when the worktree has uncommitted changes, untracked files, or committed work beyond
 * the sha it was branched from — i.e. anything worth surfacing back to the dispatching
 * agent rather than silently discarding. */
export function hasChanges(worktree: CreatedWorktree): boolean {
  const status = git(["status", "--porcelain"], worktree.path);
  if (status.trim().length > 0) return true;
  const head = git(["rev-parse", "HEAD"], worktree.path).trim();
  return head !== worktree.baseSha;
}

/** Removes a worktree and its branch. Only ever called on worktrees confirmed to have no
 * changes (see `hasChanges()`) — deliberately force-removes since a clean worktree has
 * nothing left to lose. Best-effort: callers should not let a cleanup failure fail the whole
 * sub-agent task, just surface a warning (see runtime.ts). */
export function removeWorktree(worktree: CreatedWorktree): void {
  git(["worktree", "remove", "--force", worktree.path], worktree.repoCwd);
  git(["branch", "-D", worktree.branch], worktree.repoCwd);
}
