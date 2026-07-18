// ReportOutcome tool — DH-0050. Structured, authoritative self-report for the standalone
// `--instructions`/`--job` dark-factory path (never registered for interactive sessions —
// see runtime.ts's conditional registration, tools/index.ts's own doc comment). The loop,
// not this tool, is the authority on what a valid call means for control flow: `execute()`
// here has zero side effects, only validates and produces the model-facing acknowledgement/
// correction text. `loop.ts` separately re-parses the same `tool_use` block's input via
// `parseReportedOutcome()` (exported below, shared so the two can't drift) to decide whether
// to terminate the run.

import { REPORT_OUTCOME_TOOL_NAME, type ReportedOutcome } from "../../contracts/index.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

/** Leniently parses a `ReportOutcome` tool_use's raw `input` into a `ReportedOutcome`, or
 * `null` if `status` isn't a valid value. Optional fields are carried through only when
 * they're the expected shape (string / string[]) — a garbled optional field degrades to
 * "absent" rather than invalidating an otherwise-valid call, matching the design's "garbled
 * payloads degrade gracefully" argument (only `status` is load-bearing for control flow). */
export function parseReportedOutcome(input: unknown): ReportedOutcome | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  const status = record.status;
  if (status !== "success" && status !== "failure") return null;

  const outcome: ReportedOutcome = { status };
  if (typeof record.summary === "string") outcome.summary = record.summary;
  if (
    Array.isArray(record.filesChanged) &&
    record.filesChanged.every((f) => typeof f === "string")
  ) {
    outcome.filesChanged = record.filesChanged as string[];
  }
  if (Array.isArray(record.artifacts) && record.artifacts.every((a) => typeof a === "string")) {
    outcome.artifacts = record.artifacts as string[];
  }
  return outcome;
}

export const reportOutcomeTool: Tool = {
  name: REPORT_OUTCOME_TOOL_NAME,
  description:
    "Call this tool exactly once, as the very last action of your run, to report whether " +
    'you completed the task ("success") or could not ("failure"). This is the authoritative, ' +
    "structured way to end a run — always prefer it over ending your turn with no tool call. " +
    "Include a short summary, and filesChanged/artifacts when relevant. After calling it, end " +
    "your turn immediately with no further tool calls or text.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["success", "failure"] },
      summary: { type: "string" },
      filesChanged: { type: "array", items: { type: "string" } },
      artifacts: { type: "array", items: { type: "string" } },
    },
    required: ["status"],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const outcome = parseReportedOutcome(input);
    if (!outcome) {
      return {
        output: `ReportOutcome tool error: 'status' must be "success" or "failure" (got ${JSON.stringify(input.status)}). Call ReportOutcome again with a valid status.`,
        isError: true,
      };
    }
    return {
      output: "Outcome recorded. End your turn now without further tool calls.",
      isError: false,
    };
  },
};
