// Shared name-or-id resolution for SendMessage/Monitor (DH-0078,
// tracking/DH-0078-*.md) — since DH-0069 made the Agent tool's `description` a required,
// meaningful label, both tools let the dispatching agent address a sub-agent by that name
// instead of only its opaque task id. Name resolution is scoped to the *calling* agent's own
// visible tasks (`ctx.tasks.list()` filtered to `parentAgentId === ctx.agentId`) — per the
// ticket's own Assumptions, not a global namespace across the whole run.

import type { ToolContext } from "./types.ts";

export type TaskIdResolution = { id: string } | { error: string };

/** Resolves a single `task_id` or `name` (mutually exclusive) into a concrete task id.
 * Ambiguity (multiple of the calling agent's own tasks share the same description) is a
 * hard error listing every matching task id — never a silent "most recent wins" guess, per
 * the same read-before-write "error rather than guess" precedent used elsewhere in this
 * codebase (see tools/edit.ts's read-before-write guard). */
export function resolveTaskId(
  ctx: ToolContext,
  toolName: string,
  taskId: unknown,
  name: unknown,
): TaskIdResolution {
  if (taskId !== undefined && name !== undefined) {
    return {
      error: `${toolName} tool error: provide either 'task_id' or 'name', not both.`,
    };
  }
  if (taskId !== undefined) {
    if (typeof taskId !== "string" || taskId.length === 0) {
      return { error: `${toolName} tool error: 'task_id' must be a non-empty string.` };
    }
    return { id: taskId };
  }
  if (name !== undefined) {
    if (typeof name !== "string" || name.length === 0) {
      return { error: `${toolName} tool error: 'name' must be a non-empty string.` };
    }
    return resolveByName(ctx, toolName, name);
  }
  return {
    error: `${toolName} tool error: either 'task_id' or 'name' is required.`,
  };
}

/** Resolves a `name` string against the calling agent's own spawned tasks. Exported
 * separately so Monitor (which accepts an array of names alongside an array of ids) can
 * resolve each entry independently without going through the single task_id/name mutual-
 * exclusion check above. */
export function resolveByName(ctx: ToolContext, toolName: string, name: string): TaskIdResolution {
  const candidates = ctx.tasks
    .list()
    .filter((t) => t.parentAgentId === ctx.agentId && t.description === name);
  if (candidates.length === 0) {
    return {
      error: `${toolName} tool error: no sub-agent named "${name}" found among tasks spawned by this agent.`,
    };
  }
  if (candidates.length > 1) {
    return {
      error: `${toolName} tool error: "${name}" is ambiguous — matches multiple tasks (${candidates.map((c) => c.id).join(", ")}); address by task_id instead.`,
    };
  }
  // biome-ignore lint/style/noNonNullAssertion: length is exactly 1 here (0 and >1 handled above)
  return { id: candidates[0]!.id };
}
