// TaskStop tool — stops a background task or sub-agent by id (HANDOFF.md §4).

import { TaskNotFoundError } from "../tasks.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const taskStopTool: Tool = {
  name: "TaskStop",
  description: "Stop a running background task or sub-agent by task id.",
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
        output: "TaskStop tool error: 'task_id' must be a non-empty string.",
        isError: true,
      };
    }

    try {
      ctx.tasks.stop(taskId);
    } catch (err) {
      if (!(err instanceof TaskNotFoundError)) throw err;
      return { output: `TaskStop tool error: ${err.message}`, isError: true };
    }

    return { output: `Stopped ${taskId}.`, isError: false };
  },
};
