// TaskOutput tool — retrieves a background task's / sub-agent's accumulated output
// (HANDOFF.md §4).

import { TaskNotFoundError } from "../tasks.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const taskOutputTool: Tool = {
  name: "TaskOutput",
  description:
    "Retrieve the accumulated output and status of a background task or sub-agent by id.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
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

    try {
      const snapshot = ctx.tasks.snapshot(taskId);
      const header = `status=${snapshot.status}${snapshot.error ? ` error=${snapshot.error}` : ""}`;
      return { output: `${header}\n${snapshot.output}`, isError: false };
    } catch (err) {
      if (!(err instanceof TaskNotFoundError)) throw err;
      return { output: `TaskOutput tool error: ${err.message}`, isError: true };
    }
  },
};
