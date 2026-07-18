// TodoGet tool — full record for one item in this agent's own todo list (DH-0076).

import type { TodoRecord } from "../todos.ts";
import { TodoNotFoundError } from "../todos.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

function formatRecord(record: TodoRecord): string {
  const lines = [
    `id: ${record.id}`,
    `status: ${record.status}`,
    `subject: ${record.subject}`,
    `description: ${record.description ?? "(none)"}`,
    `active_form: ${record.activeForm ?? "(none)"}`,
    `blocked_by: ${record.blockedBy.size > 0 ? [...record.blockedBy].join(", ") : "(none)"}`,
    `blocks: ${record.blocks.size > 0 ? [...record.blocks].join(", ") : "(none)"}`,
    `created_at: ${record.createdAt}`,
    `updated_at: ${record.updatedAt}`,
  ];
  return lines.join("\n");
}

export const todoGetTool: Tool = {
  name: "TodoGet",
  description: "Retrieve the full record for one item in your own todo list, by its todo id.",
  inputSchema: {
    type: "object",
    properties: {
      todo_id: { type: "string" },
    },
    required: ["todo_id"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const todoId = input.todo_id;
    if (typeof todoId !== "string" || todoId.length === 0) {
      return {
        output: "TodoGet tool error: 'todo_id' must be a non-empty string.",
        isError: true,
      };
    }

    try {
      const record = ctx.todos.get(todoId);
      return { output: formatRecord(record), isError: false };
    } catch (err) {
      if (!(err instanceof TodoNotFoundError)) throw err;
      return { output: `TodoGet tool error: ${err.message}`, isError: true };
    }
  },
};
