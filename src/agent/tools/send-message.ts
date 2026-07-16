// SendMessage tool — sends a message into a running agent's conversation (HANDOFF.md §4).
// Only agent-kind tasks accept messages; a bash-kind task id, or an agent that hasn't
// registered its message sink yet, errors clearly.
//
// DH-0078 (tracking/DH-0078-*.md): addressable by either `task_id` or the sub-agent's own
// `name` (the same string as the Agent tool's required `description` param) — see
// resolve-task.ts for the shared name-resolution rule (error on ambiguity, scoped to the
// calling agent's own spawned tasks).

import { TaskFinishedError, TaskNotFoundError } from "../tasks.ts";
import { resolveTaskId } from "./resolve-task.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const sendMessageTool: Tool = {
  name: "SendMessage",
  description:
    "Send a message into a running sub-agent's conversation, addressed by task id or by " +
    "the name (description) it was spawned with.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      name: {
        type: "string",
        description:
          "Address the sub-agent by the human-readable name it was spawned with (the " +
          "Agent tool's `description` param), instead of its task_id. Mutually exclusive " +
          "with task_id; errors if the name is ambiguous among this agent's own sub-agents.",
      },
      message: { type: "string" },
    },
    required: ["message"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const message = input.message;
    if (typeof message !== "string" || message.length === 0) {
      return {
        output: "SendMessage tool error: 'message' must be a non-empty string.",
        isError: true,
      };
    }
    const resolution = resolveTaskId(ctx, "SendMessage", input.task_id, input.name);
    if ("error" in resolution) {
      return { output: resolution.error, isError: true };
    }
    const taskId = resolution.id;

    try {
      ctx.tasks.sendMessage(taskId, message);
    } catch (err) {
      // Round 13 (docs/handoffs/core.md): previously this fell through to a generic
      // "delivery failed" message while `tasks.sendMessage()` actually threw nothing — the
      // real bug was that a finished task's stale `sendMessage` sink silently accepted the
      // call and the message was never read again, while the tool still reported success.
      // TaskFinishedError (thrown by tasks.ts now that finished status is checked first)
      // makes that state explicit instead of a false "delivered" claim.
      if (err instanceof TaskFinishedError) {
        return {
          output: `SendMessage tool error: task ${taskId} has already finished; message not delivered.`,
          isError: true,
        };
      }
      const prefix = err instanceof TaskNotFoundError ? "" : "delivery failed: ";
      return {
        output: `SendMessage tool error: ${prefix}${(err as Error).message}`,
        isError: true,
      };
    }

    return { output: `Message delivered to ${taskId}.`, isError: false };
  },
};
