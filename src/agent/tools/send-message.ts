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
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

export const sendMessageTool: Tool = Object.freeze<Tool>({
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
    // 'task_id'/'name' aren't scoped in — their type-mismatch checks and mutual-exclusivity
    // logic live inside resolveTaskId() with their own error wording.
    const validation = validateInput(
      {
        type: "object",
        properties: { message: sendMessageTool.inputSchema.properties.message },
        required: ["message"],
      },
      "SendMessage",
      input,
    );
    if (!validation.ok) return validation.result;
    const message = input.message as string;
    const resolution = resolveTaskId(ctx, "SendMessage", input.task_id, input.name);
    if ("error" in resolution) {
      return { output: resolution.error, isError: true };
    }
    const taskId = resolution.id;

    try {
      ctx.sendMessage(taskId, message);
    } catch (err) {
      // Round 13 (docs/handoffs/core.md): previously this fell through to a generic
      // "delivery failed" message while `tasks.sendMessage()` actually threw nothing — the
      // real bug was that a finished task's stale `sendMessage` sink silently accepted the
      // call and the message was never read again, while the tool still reported success.
      // TaskFinishedError (thrown by tasks.ts now that finished status is checked first)
      // makes that state explicit instead of a false "delivered" claim.
      //
      // DH-0003: this is now only ever reached for a *bash*-kind terminal task (no
      // conversation to resume) — `ctx.sendMessage()` (AgentRuntime.sendMessage) resumes a
      // finished *agent*-kind task's conversation instead of throwing, so that case no longer
      // reaches here at all.
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
});
