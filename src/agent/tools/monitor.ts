// Monitor tool — checks status of one or more running tasks/agents (HANDOFF.md §4).
//
// DH-0078 (tracking/DH-0078-*.md): each entry may be addressed by task id (`task_ids`) or by
// the sub-agent's own name (`names`, the Agent tool's `description` param) — see
// resolve-task.ts for the shared name-resolution rule. An ambiguous name reports an error
// line for that one entry rather than failing the whole call, matching this tool's existing
// "a bad id doesn't fail the whole call" behavior for unknown task ids.

import { TaskNotFoundError } from "../tasks.ts";
import { resolveByName } from "./resolve-task.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const monitorTool: Tool = {
  name: "Monitor",
  description:
    "Check the status of one or more background tasks or sub-agents, by task id (task_ids) " +
    "and/or by the name (description) they were spawned with (names).",
  inputSchema: {
    type: "object",
    properties: {
      task_ids: { type: "array", items: { type: "string" } },
      names: {
        type: "array",
        items: { type: "string" },
        description:
          "Sub-agent names (the Agent tool's `description` param) to look up, scoped to " +
          "this agent's own spawned tasks.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const taskIds = input.task_ids;
    const names = input.names;
    const taskIdsValid = taskIds === undefined || Array.isArray(taskIds);
    const namesValid = names === undefined || Array.isArray(names);
    const idsEmpty = taskIds === undefined || (taskIds as unknown[]).length === 0;
    const namesEmpty = names === undefined || (names as unknown[]).length === 0;
    if (
      !taskIdsValid ||
      !namesValid ||
      (Array.isArray(taskIds) && taskIds.some((id) => typeof id !== "string")) ||
      (Array.isArray(names) && names.some((n) => typeof n !== "string")) ||
      (idsEmpty && namesEmpty)
    ) {
      return {
        output:
          "Monitor tool error: provide a non-empty 'task_ids' and/or 'names' array of strings.",
        isError: true,
      };
    }

    const lines: string[] = [];
    for (const id of (taskIds ?? []) as string[]) {
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
    for (const name of (names ?? []) as string[]) {
      const resolution = resolveByName(ctx, "Monitor", name);
      if ("error" in resolution) {
        lines.push(`name "${name}": ${resolution.error}`);
        continue;
      }
      const snapshot = ctx.tasks.snapshot(resolution.id);
      lines.push(
        `${snapshot.id} [${snapshot.kind}] status=${snapshot.status}${snapshot.model ? ` model=${snapshot.model}` : ""}${snapshot.description ? ` description="${snapshot.description}"` : ""}`,
      );
    }
    return { output: lines.join("\n"), isError: false };
  },
};
