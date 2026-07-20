// TodoList tool — compact listing of this agent's own todo list plus a count summary
// (DH-0076). Zero parameters: rereading current ground truth costs a few dozen tokens.

import type { TodoRecord } from "../todos.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

function formatLine(record: TodoRecord): string {
  const suffix =
    record.blockedBy.size > 0 ? ` (blocked_by: ${[...record.blockedBy].join(", ")})` : "";
  return `${record.id} [${record.status}] ${record.subject}${suffix}`;
}

export const todoListTool: Tool = Object.freeze<Tool>({
  name: "TodoList",
  description:
    "List every item in your own todo list, compactly, with a count summary. Use this to " +
    "re-check your own plan's current state at any point in a long task.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async execute(_input, ctx: ToolContext): Promise<ToolResult> {
    const records = ctx.todos.list();
    if (records.length === 0) {
      return { output: "No todos yet.", isError: false };
    }

    const counts = new Map<string, number>();
    for (const record of records) {
      counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
    }
    const summary = [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(", ");

    const lines = records.map(formatLine);
    return {
      output: `${lines.join("\n")}\n\n${records.length} total (${summary})`,
      isError: false,
    };
  },
});
