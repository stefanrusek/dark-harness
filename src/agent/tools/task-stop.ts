// TaskStop tool — stops a background task or sub-agent by id (HANDOFF.md §4).

import { TaskFinishedError, TaskNotFoundError } from "../tasks.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

export const taskStopTool: Tool = Object.freeze<Tool>({
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
    const validation = validateInput(taskStopTool.inputSchema, "TaskStop", input);
    if (!validation.ok) return validation.result;
    const taskId = input.task_id as string;

    try {
      ctx.tasks.stop(taskId);
    } catch (err) {
      // Round 13 (docs/handoffs/core.md): stopping an already-finished task is not an error —
      // report the true state instead of either a false "Stopped" claim or a hard failure.
      if (err instanceof TaskFinishedError) {
        return {
          output: `TaskStop: ${taskId} is already finished; nothing to stop.`,
          isError: false,
        };
      }
      if (!(err instanceof TaskNotFoundError)) throw err;
      return { output: `TaskStop tool error: ${err.message}`, isError: true };
    }

    return { output: `Stopped ${taskId}.`, isError: false };
  },
});
