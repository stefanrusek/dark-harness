// DH-0173: extracted from AgentRuntime.spawnAgent() — DH-0077 isolation-worktree lifecycle
// bookkeeping (which sub-agents have a live isolation worktree, and the concurrency budget
// on how many may be live at once). Behavior-preserving extraction: creation/removal still
// goes through worktree.ts's own createWorktree/removeWorktree/hasChanges; this class only
// owns the registry (agentId -> CreatedWorktree) and the live-count budget check that used
// to be two loose fields (`agentWorktree`, `liveWorktreeCount`) directly on AgentRuntime.

import { type CreatedWorktree, WorktreeError, createWorktree } from "./worktree.ts";

/** DH-0077: default cap on concurrently-live isolation worktrees when `options.
 * maxConcurrentAgents` is left unset — worktree creation has real disk/git overhead a plain
 * in-process sub-agent spawn doesn't, so it's never left fully unbounded even when the
 * general agent-fanout budget is. */
export const DEFAULT_MAX_CONCURRENT_WORKTREES = 4;

export class WorktreeRegistry {
  private readonly byAgentId = new Map<string, CreatedWorktree>();
  private liveCount = 0;

  /** Validates the concurrency budget and creates a fresh isolation worktree for `agentId`
   * off `parentCwd`, registering it. Throws (never partially registers) if the budget is
   * exceeded or worktree creation itself fails — mirrors the synchronous-refusal contract
   * spawnAgent()'s depth/concurrency checks already have. */
  reserve(
    agentId: string,
    parentCwd: string,
    maxConcurrentAgents: number | undefined,
  ): CreatedWorktree {
    const worktreeCap = maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_WORKTREES;
    if (this.liveCount >= worktreeCap) {
      throw new Error(
        `spawn refused: ${this.liveCount} isolated worktree(s) already live, at ` +
          `the ${maxConcurrentAgents !== undefined ? "configured options.maxConcurrentAgents" : "default worktree"} ` +
          `(${worktreeCap}) limit.`,
      );
    }
    let worktree: CreatedWorktree;
    try {
      worktree = createWorktree(parentCwd, agentId);
    } catch (err) {
      throw new WorktreeError(
        `spawn refused: failed to create isolation worktree: ${(err as Error).message}`,
      );
    }
    this.byAgentId.set(agentId, worktree);
    this.liveCount += 1;
    return worktree;
  }

  get(agentId: string): CreatedWorktree | undefined {
    return this.byAgentId.get(agentId);
  }

  /** Unregisters `agentId`'s worktree (if any) and returns it for the caller to inspect/clean
   * up — mirrors the old inline `agentWorktree.delete()` + `liveWorktreeCount -= 1` pair in
   * spawnAgent()'s `finally` block. No-op (returns undefined) if `agentId` never had one. */
  release(agentId: string): CreatedWorktree | undefined {
    const worktree = this.byAgentId.get(agentId);
    if (!worktree) return undefined;
    this.byAgentId.delete(agentId);
    this.liveCount -= 1;
    return worktree;
  }
}
