// Agent tool — spawns an ad-hoc sub-agent (HANDOFF.md §4, §6). No named/predefined agent
// definitions: takes a model name (looked up in dh.json models, falling back to
// options.defaultModel) and a prompt. Nesting is unbounded. run_in_background defaults to
// true (overridable by options.runInBackgroundDefault / the per-call flag) — when true the
// tool returns immediately with a task id; the caller observes it via Monitor/TaskOutput/
// SendMessage/TaskStop. When false, the tool blocks until the sub-agent finishes and returns
// its final output directly.

import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

function resolveModelName(
  input: Record<string, unknown>,
  ctx: ToolContext,
): string | { error: string } {
  // Validated as an optional string by validateInput() before this is called (see
  // agentTool.execute()), so the cast here is safe.
  const requested = input.model as string | undefined;
  const name = requested ?? ctx.config.options.defaultModel;
  const known = ctx.config.models.some((m) => m.name === name);
  if (!known) {
    return {
      error: `Agent tool error: unknown model "${name}"; known models: ${ctx.config.models.map((m) => m.name).join(", ")}`,
    };
  }
  return name;
}

export const agentTool: Tool = Object.freeze<Tool>({
  name: "Agent",
  description:
    "Spawn an ad-hoc sub-agent with a model and a prompt. Runs concurrently by default " +
    "(run_in_background: true); observe it with Monitor, retrieve output with TaskOutput, " +
    "steer it with SendMessage, or stop it with TaskStop.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The task for the sub-agent to perform." },
      model: {
        type: "string",
        description: "Model name from dh.json; defaults to options.defaultModel.",
      },
      description: {
        type: "string",
        description:
          "A short (3-5 word) description of the task, shown as this sub-agent's label " +
          "everywhere it's displayed (the agent tree, Monitor output, and its log header) " +
          "— the harness never derives a name from the prompt itself, so this is required.",
      },
      run_in_background: { type: "boolean" },
      isolation: {
        type: "string",
        enum: ["worktree"],
        description:
          "When set to 'worktree', the sub-agent runs in a freshly created git worktree " +
          "(its own branch) instead of the parent's working tree/cwd — use for risky or " +
          "experimental file edits that shouldn't collide with the parent's or siblings' " +
          "in-progress changes. Requires the parent's cwd to be inside a git repository. " +
          "The worktree is cleaned up automatically if it ends up with no changes; if it " +
          "does have changes, the worktree path and branch are reported back in the " +
          "sub-agent's result for the dispatching agent to review/merge.",
      },
    },
    required: ["prompt", "description"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    // DH-0069: 'description' is required at the schema level (matching real Claude Code's
    // own Agent tool, whose required "description" string is the exact label it displays for
    // a sub-agent — dh never derives a name from the prompt). Schema `required` is only
    // advisory to the model, so this runtime check makes a model that ignores it get a clear
    // tool error instead of silently spawning an unlabeled agent that renders as a raw
    // agentId/UUID in the TUI/Web tree.
    const validation = validateInput(agentTool.inputSchema, "Agent", input);
    if (!validation.ok) return validation.result;

    const prompt = input.prompt as string;
    const description = input.description as string;

    const modelResult = resolveModelName(input, ctx);
    if (typeof modelResult !== "string") {
      return { output: modelResult.error, isError: true };
    }
    const model = modelResult;

    // DH-0077: optional worktree isolation, mirroring real Claude Code's Agent tool shape.
    // Validated here (not just left to the schema's `enum`) because schema `enum` is only
    // advisory to the model, same precedent as the `description` required-check above.
    const isolationInput = input.isolation;
    if (isolationInput !== undefined && isolationInput !== "worktree") {
      return {
        output: `Agent tool error: unsupported 'isolation' value "${String(isolationInput)}"; only "worktree" is supported.`,
        isError: true,
      };
    }
    const isolation = isolationInput === "worktree" ? ("worktree" as const) : undefined;

    const runInBackground =
      typeof input.run_in_background === "boolean"
        ? input.run_in_background
        : ctx.runInBackgroundDefault;

    // DH-0013 (tracking/DH-0013-no-cost-turn-time-or-fanout-budgets.md): ctx.spawnAgent()
    // (runtime.ts) throws synchronously when a configured maxConcurrentAgents/maxAgentDepth
    // budget would be exceeded — caught here and surfaced as a normal tool-error result (a
    // clear refusal the spawning agent's own turn can react to), rather than an uncaught
    // exception escaping this tool call and crashing the whole loop.
    let taskId: string;
    try {
      taskId = ctx.spawnAgent({
        model,
        prompt,
        background: runInBackground,
        description,
        ...(isolation !== undefined ? { isolation } : {}),
      });
    } catch (err) {
      return {
        output: `Agent tool error: ${(err as Error).message}`,
        isError: true,
      };
    }

    if (runInBackground) {
      return {
        output: `Spawned sub-agent as task ${taskId} (model: ${model}). Use Monitor/TaskOutput/SendMessage/TaskStop with this id.`,
        isError: false,
      };
    }

    await ctx.tasks.awaitDone(taskId);
    const snapshot = ctx.tasks.snapshot(taskId);
    if (snapshot.status === "failed") {
      return {
        output: `${snapshot.output}\n[error] ${snapshot.error ?? "sub-agent failed"}`,
        isError: true,
      };
    }
    return { output: snapshot.output, isError: false };
  },
});
