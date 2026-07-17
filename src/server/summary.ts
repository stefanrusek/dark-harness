// DH-0037 (tracking/DH-0037-*.md), piece 1 of the ticket's remaining scope: the standalone
// `--instructions --job` path's `summary.json`. Sequenced after DH-0050 landed (that ticket's
// architect design already committed to `ReportedOutcome`/`JobResultLine`'s field names —
// `success`, `turns`, `outcome`, `reportedBy` — being the ones any downstream summary reuses,
// not a parallel shape). Cost/duration/agent-count aren't tracked anywhere convenient at the
// `AgentRuntime` call site, but the session's own JSONL files already carry everything needed
// once the run has finished — same source `dh logs`/log-analysis.ts already reads — so this
// derives them from the log directory rather than threading new accounting through the loop.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobResultLine } from "../contracts/index.ts";
import { readSessionLogSummaries } from "./log-analysis.ts";

/** The `summary.json` written into a finished `--job` run's session log directory. Mirrors
 * `JobResultLine`'s own field names/shapes verbatim for the fields both share — a downstream
 * orchestrator reading either shouldn't have to reconcile two conventions for "success" or
 * "turns" — and adds the three fields the ticket asks for that only the finished log
 * directory can answer: total cost, wall-clock duration, and agent count. */
export interface SessionSummary {
  version: 1;
  sessionId: string;
  timestamp: string;
  success: boolean;
  exitCode: 0 | 1;
  reportedBy: JobResultLine["reportedBy"];
  turns: number;
  /** Sum of every agent's `costUsd` in the session, per `AgentLogSummary.costUsd`. Undefined
   * if no agent in the session recorded a cost (e.g. pricing wasn't configured). */
  costUsd?: number;
  /** Latest recorded event timestamp across every agent in the session minus the earliest
   * `spawnedAt` (the root agent's, in practice). Undefined if the log directory has no
   * agent whose header parsed (nothing to measure against). */
  durationMs?: number;
  agentCount: number;
  outcome?: JobResultLine["outcome"];
}

/** Derives a `SessionSummary` from a finished session's log directory and the same
 * `JobResultLine`-shaped result `--job --json` would have emitted to stdout — reusing its
 * fields rather than recomputing `success`/`exitCode`/`reportedBy`/`turns`/`outcome`, which
 * only the caller (loop.ts's `AgentLoopResult`) actually knows. Cost/duration/agent-count are
 * derived here from `readSessionLogSummaries`, the same per-agent JSONL scan `dh logs` uses. */
export function buildSessionSummary(
  sessionId: string,
  logDir: string,
  job: JobResultLine,
): SessionSummary {
  const summaries = readSessionLogSummaries(logDir);

  const costUsd = summaries.reduce<number | undefined>(
    (total, s) => (s.costUsd === undefined ? total : (total ?? 0) + s.costUsd),
    undefined,
  );

  const spawnTimes = summaries.map((s) => Date.parse(s.spawnedAt)).filter((t) => !Number.isNaN(t));
  const endTime = Date.parse(job.timestamp);
  const earliestSpawn = spawnTimes.length > 0 ? Math.min(...spawnTimes) : undefined;
  const durationMs =
    earliestSpawn !== undefined && !Number.isNaN(endTime) ? endTime - earliestSpawn : undefined;

  return {
    version: 1,
    sessionId,
    timestamp: job.timestamp,
    success: job.success,
    exitCode: job.exitCode,
    reportedBy: job.reportedBy,
    turns: job.turns,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    agentCount: summaries.length,
    ...(job.outcome !== undefined ? { outcome: job.outcome } : {}),
  };
}

/** Writes `summary.json` into `logDir`, alongside the session's per-agent JSONL files. */
export function writeSessionSummary(logDir: string, summary: SessionSummary): void {
  writeFileSync(join(logDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
