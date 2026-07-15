// SendMessage tool — sends a message into a running agent's conversation (HANDOFF.md §4).
// Only agent-kind tasks accept messages; a bash-kind task id, or an agent that hasn't
// registered its message sink yet, errors clearly.

import { TaskFinishedError, TaskNotFoundError } from "../tasks.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const sendMessageTool: Tool = {
  name: "SendMessage",
  description: "Send a message into a running sub-agent's conversation by task id.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      message: { type: "string" },
    },
    required: ["task_id", "message"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const taskId = input.task_id;
    const message = input.message;
    if (typeof taskId !== "string" || taskId.length === 0) {
      return {
        output: "SendMessage tool error: 'task_id' must be a non-empty string.",
        isError: true,
      };
    }
    if (typeof message !== "string" || message.length === 0) {
      return {
        output: "SendMessage tool error: 'message' must be a non-empty string.",
        isError: true,
      };
    }

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
