// TodoCreate tool — adds an item to this agent's own self-authored todo list (DH-0076).
// See src/agent/todos.ts for the store's design rationale (per-agent, in-memory, distinct
// from TaskRegistry).

import { TodoCapExceededError, TodoNotFoundError } from "../todos.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

export const todoCreateTool: Tool = Object.freeze<Tool>({
  name: "TodoCreate",
  description:
    "Add an item to your own structured todo list — a self-authored plan/checklist for " +
    "multi-step work, not a job-supervision mechanism (see TaskOutput/Monitor/TaskStop for " +
    "that). Use for tracking discrete steps of a long task so you can re-read your own plan " +
    "later via TodoList/TodoGet instead of relying on prose scrollback.",
  inputSchema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Brief imperative title, e.g. 'Fix auth token refresh'",
      },
      description: {
        type: "string",
        description: "Optional fuller context / acceptance criteria",
      },
      active_form: {
        type: "string",
        description:
          "Optional present-continuous label shown while in progress, e.g. 'Fixing auth token refresh'",
      },
      blocked_by: {
        type: "array",
        items: { type: "string" },
        description: "Optional todo ids that should complete before this one",
      },
    },
    required: ["subject"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const validation = validateInput(todoCreateTool.inputSchema, "TodoCreate", input);
    if (!validation.ok) return validation.result;

    const subject = input.subject as string;
    const blockedBy = input.blocked_by as string[] | undefined;

    try {
      const record = ctx.todos.create({
        subject,
        ...(typeof input.description === "string" ? { description: input.description } : {}),
        ...(typeof input.active_form === "string" ? { activeForm: input.active_form } : {}),
        ...(blockedBy ? { blockedBy } : {}),
      });
      return { output: `Created ${record.id}: ${record.subject}`, isError: false };
    } catch (err) {
      if (err instanceof TodoNotFoundError || err instanceof TodoCapExceededError) {
        return { output: `TodoCreate tool error: ${err.message}`, isError: true };
      }
      throw err;
    }
  },
});
