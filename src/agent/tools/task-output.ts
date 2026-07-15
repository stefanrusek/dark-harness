// TaskOutput tool — retrieves a background task's / sub-agent's output (HANDOFF.md §4).
//
// Round 13 (docs/handoffs/core.md): defaults to an incremental delta — only output appended
// since this caller's own last TaskOutput call for this task id — instead of resending the
// full accumulated buffer every poll, which quadratically re-feeds a chatty long-running
// task's whole transcript into context on every check. `full: true` opts back into the old
// full-buffer behavior when that's actually useful (e.g. the very first check, or wanting a
// clean re-read).

import { TaskNotFoundError } from "../tasks.ts";
import { capOutput } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const taskOutputTool: Tool = {
  name: "TaskOutput",
  description:
    "Retrieve new output and status of a background task or sub-agent by id. By default " +
    "returns only output produced since your last TaskOutput call for this id (an incremental " +
    "delta, not the full history); pass full: true to get the entire accumulated output instead.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      full: {
        type: "boolean",
        description: "Return the full accumulated output instead of just what's new.",
      },
    },
    required: ["task_id"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const taskId = input.task_id;
    if (typeof taskId !== "string" || taskId.length === 0) {
      return {
        output: "TaskOutput tool error: 'task_id' must be a non-empty string.",
        isError: true,
      };
    }
    const full = input.full === true;

    try {
      const snapshot = ctx.tasks.snapshot(taskId);
      const header = `status=${snapshot.status}${snapshot.error ? ` error=${snapshot.error}` : ""}`;

      if (full) {
        const capped = capOutput(snapshot.output);
        return { output: `${header}\n${capped.text}`, isError: false };
      }

      const { delta, totalLength } = ctx.tasks.outputSince(taskId, ctx.agentId);
      const capped = capOutput(delta);
      const body = capped.text.length > 0 ? capped.text : "(no new output since your last check)";
      return {
        output: `${header}\n${body}\n[incremental: showing only new output; ${totalLength} chars total accumulated — pass full: true to see everything]`,
        isError: false,
      };
    } catch (err) {
      if (!(err instanceof TaskNotFoundError)) throw err;
      return { output: `TaskOutput tool error: ${err.message}`, isError: true };
    }
  },
};
