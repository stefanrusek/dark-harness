// DH-0050 (tracking/DH-0050-*.md, architect design Fable 2026-07-15): structured self-report
// mechanism. A new built-in `ReportOutcome` tool (src/agent/tools/report-outcome.ts) the
// model is instructed to call as its final action in non-interactive (standalone
// `--instructions`/`--job`) runs, superseding the free-text `TASK_FAILED` marker scan as the
// authoritative signal — the marker scan is retained as a deprecated fallback (loop.ts).

/** Name of the built-in self-report tool, shared by its registration (tools/index.ts), its
 * implementation (report-outcome.ts), and the agent loop's own detection (loop.ts) — a single
 * source so none of the three can drift out of sync with each other. */
export const REPORT_OUTCOME_TOOL_NAME = "ReportOutcome";

/** The structured payload a valid `ReportOutcome` call carries. All fields but `status` are
 * optional free-form detail the model may or may not choose to fill in. */
export interface ReportedOutcome {
  status: "success" | "failure";
  /** 1-3 sentence plain-language outcome. */
  summary?: string;
  /** Repo-relative paths created/modified/deleted. */
  filesChanged?: string[];
  /** Deliverables beyond changed source (paths/URLs). */
  artifacts?: string[];
}

/** DH-0050's detection precedence, in the order loop.ts actually checks them — a `JobResultLine`
 * always names exactly which of these produced its `success`/`exitCode`, never left implicit. */
export type OutcomeReportedBy = "tool" | "text-marker" | "clean-end" | "max-tokens" | "max-turns";

/** Terminal NDJSON line for `--job --json` (the NDJSON progress stream — independently
 * shippable second story of this ticket's design). Closes the stream after every
 * `ServerSentEvent` the root emits has already been written, one per line, verbatim. */
export interface JobResultLine {
  version: 1;
  type: "job_result";
  timestamp: string;
  success: boolean;
  exitCode: 0 | 1;
  reportedBy: OutcomeReportedBy;
  turns: number;
  finalOutput: string;
  /** Present iff `reportedBy === "tool"`. */
  outcome?: ReportedOutcome;
}
