// DH-0034: every e2e test file previously kept one flat `cleanups: (() => void)[]` stack and
// relied on the test author pushing in the right order (workspace cleanup *before* process
// kill, so LIFO `pop()` runs kill first) — nothing enforced it, so a future test that pushes
// `ws.cleanup` after `proc.kill` would silently try to `rmSync` a directory a still-running
// process has open handles/cwd in, or race a process teardown against directory removal.
//
// This registry makes the ordering structural instead of conventional: two separate stacks,
// `process` cleanups (kill a spawned OS process, close an SSE connection, kill a tmux
// session, close a browser) always run to completion — each awaited, in LIFO order — before
// any `workspace` cleanup (removing a scratch directory) runs, regardless of the order
// callers registered them in.

export interface CleanupRegistry {
  /** Register a "stop a live thing" cleanup — killing a spawned process, closing an SSE
   * connection or browser, killing a tmux session. Always runs before every `addWorkspace`
   * cleanup. */
  addProcess(fn: () => void | Promise<void>): void;
  /** Register a workspace-teardown cleanup (e.g. `TestWorkspace.cleanup`, an `rmSync`).
   * Always runs after every `addProcess` cleanup has completed. */
  addWorkspace(fn: () => void | Promise<void>): void;
  /** Runs every registered cleanup: all `process` cleanups (most-recently-added first), then
   * all `workspace` cleanups (most-recently-added first). Safe to call from `afterEach`. */
  runAll(): Promise<void>;
}

export function createCleanupRegistry(): CleanupRegistry {
  const processCleanups: (() => void | Promise<void>)[] = [];
  const workspaceCleanups: (() => void | Promise<void>)[] = [];
  return {
    addProcess(fn) {
      processCleanups.push(fn);
    },
    addWorkspace(fn) {
      workspaceCleanups.push(fn);
    },
    async runAll() {
      while (processCleanups.length > 0) {
        await processCleanups.pop()?.();
      }
      while (workspaceCleanups.length > 0) {
        await workspaceCleanups.pop()?.();
      }
    },
  };
}
