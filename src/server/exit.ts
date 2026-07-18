import { ExitCode } from "../contracts/index.ts";
import type { AgentLoopHandle } from "./agent-loop.type.ts";

function normalizeExitCode(raw: number): ExitCode {
  if (raw === ExitCode.Success || raw === ExitCode.TaskFailure) return raw;
  return ExitCode.HarnessError;
}

/**
 * The hook docs/handoffs/server.md item 4 asks Server to expose for `src/cli.ts` (Core) to
 * await in `--job` mode: resolves once the agent loop reports completion (a
 * `session_ended` SSE event), mapping its `exitCode` to the ADR 0006 contract — 0/1 pass
 * through as the agent loop's own self-report, anything else collapses to the
 * `HarnessError` floor (2).
 *
 * Cross-domain note (docs/handoffs/server.md status log): this only covers the agent
 * loop's *own* self-reported outcome once it is running. A harness error that prevents the
 * agent loop from ever starting (bad config, provider/auth failure before the loop exists)
 * has nothing here to subscribe to — `src/cli.ts` must wrap its own setup in try/catch and
 * map that class of failure to `ExitCode.HarnessError` itself.
 */
export function waitForExitCode(agentLoop: AgentLoopHandle): Promise<ExitCode> {
  return new Promise((resolve) => {
    const unsubscribe = agentLoop.onEvent((event) => {
      if (event.type === "session_ended") {
        unsubscribe();
        resolve(normalizeExitCode(event.exitCode));
      }
    });
  });
}
