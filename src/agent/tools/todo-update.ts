// TodoUpdate tool — the sole mutator over this agent's own todo list, including delete
// (DH-0076; mirrors real Claude Code, where TaskUpdate is the one mutation surface).

import { TodoNotFoundError } from "../todos.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

const VALID_STATUSES = Object.freeze(new Set(["pending", "in_progress", "completed", "deleted"]));

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export const todoUpdateTool: Tool = Object.freeze<Tool>({
  name: "TodoUpdate",
  description:
    "Update, or delete (status: 'deleted'), one item in your own todo list. The sole " +
    "mutation surface for the Todo family — status changes, field edits, and blocked_by/" +
    "blocks dependency edges all go through here. Dependencies are advisory only: " +
    "completing a todo with open blockers succeeds, with a warning. Prefer keeping exactly " +
    "one todo 'in_progress' at a time.",
  inputSchema: {
    type: "object",
    properties: {
      todo_id: { type: "string" },
      status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"] },
      subject: { type: "string" },
      description: { type: "string" },
      active_form: { type: "string" },
      add_blocked_by: { type: "array", items: { type: "string" } },
      remove_blocked_by: { type: "array", items: { type: "string" } },
      add_blocks: { type: "array", items: { type: "string" } },
      remove_blocks: { type: "array", items: { type: "string" } },
    },
    required: ["todo_id"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const validation = validateInput(todoUpdateTool.inputSchema, "TodoUpdate", input);
    if (!validation.ok) return validation.result;
    const todoId = input.todo_id as string;

    const mutationFields = [
      "status",
      "subject",
      "description",
      "active_form",
      "add_blocked_by",
      "remove_blocked_by",
      "add_blocks",
      "remove_blocks",
    ] as const;
    if (!mutationFields.some((field) => input[field] !== undefined)) {
      return {
        output: "TodoUpdate tool error: must include at least one field to update.",
        isError: true,
      };
    }

    if (
      input.status !== undefined &&
      (typeof input.status !== "string" || !VALID_STATUSES.has(input.status))
    ) {
      return {
        output:
          "TodoUpdate tool error: 'status' must be one of pending, in_progress, completed, deleted.",
        isError: true,
      };
    }
    try {
      const result = ctx.todos.update(todoId, {
        ...(typeof input.status === "string" ? { status: input.status as never } : {}),
        ...(typeof input.subject === "string" ? { subject: input.subject } : {}),
        ...(typeof input.description === "string" ? { description: input.description } : {}),
        ...(typeof input.active_form === "string" ? { activeForm: input.active_form } : {}),
        ...(isStringArray(input.add_blocked_by) ? { addBlockedBy: input.add_blocked_by } : {}),
        ...(isStringArray(input.remove_blocked_by)
          ? { removeBlockedBy: input.remove_blocked_by }
          : {}),
        ...(isStringArray(input.add_blocks) ? { addBlocks: input.add_blocks } : {}),
        ...(isStringArray(input.remove_blocks) ? { removeBlocks: input.remove_blocks } : {}),
      });

      if (result.record === null) {
        return { output: `Deleted ${todoId}.`, isError: false };
      }
      const warningSuffix = result.warning ? `\nwarning: ${result.warning}` : "";
      return {
        output: `Updated ${result.record.id}: status=${result.record.status}${warningSuffix}`,
        isError: false,
      };
    } catch (err) {
      if (!(err instanceof TodoNotFoundError)) throw err;
      return { output: `TodoUpdate tool error: ${err.message}`, isError: true };
    }
  },
});
