// Monitor tool — checks status of one or more running tasks/agents (HANDOFF.md §4).

import { TaskNotFoundError } from "../tasks.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const monitorTool: Tool = {
  name: "Monitor",
  description: "Check the status of one or more background tasks or sub-agents by task id.",
  inputSchema: {
    type: "object",
    properties: {
      task_ids: { type: "array", items: { type: "string" } },
    },
    required: ["task_ids"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const taskIds = input.task_ids;
    if (
      !Array.isArray(taskIds) ||
      taskIds.some((id) => typeof id !== "string") ||
      taskIds.length === 0
    ) {
      return {
        output: "Monitor tool error: 'task_ids' must be a non-empty array of strings.",
        isError: true,
      };
    }

    const lines: string[] = [];
    for (const id of taskIds as string[]) {
      try {
        const snapshot = ctx.tasks.snapshot(id);
        lines.push(
          `${snapshot.id} [${snapshot.kind}] status=${snapshot.status}${snapshot.model ? ` model=${snapshot.model}` : ""}${snapshot.description ? ` description="${snapshot.description}"` : ""}`,
        );
      } catch (err) {
        if (!(err instanceof TaskNotFoundError)) throw err;
        lines.push(`${id}: not found`);
      }
    }
    return { output: lines.join("\n"), isError: false };
  },
};
