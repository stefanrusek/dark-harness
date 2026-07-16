// Agent tool — spawns an ad-hoc sub-agent (HANDOFF.md §4, §6). No named/predefined agent
// definitions: takes a model name (looked up in dh.json models, falling back to
// options.defaultModel) and a prompt. Nesting is unbounded. run_in_background defaults to
// true (overridable by options.runInBackgroundDefault / the per-call flag) — when true the
// tool returns immediately with a task id; the caller observes it via Monitor/TaskOutput/
// SendMessage/TaskStop. When false, the tool blocks until the sub-agent finishes and returns
// its final output directly.

import type { Tool, ToolContext, ToolResult } from "./types.ts";

function resolveModelName(
  input: Record<string, unknown>,
  ctx: ToolContext,
): string | { error: string } {
  const requested = input.model;
  if (requested !== undefined && typeof requested !== "string") {
    return { error: "Agent tool error: 'model' must be a string when provided." };
  }
  const name = requested ?? ctx.config.options.defaultModel;
  const known = ctx.config.models.some((m) => m.name === name);
  if (!known) {
    return {
      error: `Agent tool error: unknown model "${name}"; known models: ${ctx.config.models.map((m) => m.name).join(", ")}`,
    };
  }
  return name;
}

export const agentTool: Tool = {
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
    },
    required: ["prompt", "description"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const prompt = input.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return { output: "Agent tool error: 'prompt' must be a non-empty string.", isError: true };
    }

    // DH-0069: 'description' is required at the schema level (matching real Claude Code's
    // own Agent tool, whose required "description" string is the exact label it displays for
    // a sub-agent — dh never derives a name from the prompt). Schema `required` is only
    // advisory to the model, so this runtime check makes a model that ignores it get a clear
    // tool error instead of silently spawning an unlabeled agent that renders as a raw
    // agentId/UUID in the TUI/Web tree.
    const description = input.description;
    if (typeof description !== "string" || description.length === 0) {
      return {
        output: "Agent tool error: 'description' is required and must be a non-empty string.",
        isError: true,
      };
    }

    const modelResult = resolveModelName(input, ctx);
    if (typeof modelResult !== "string") {
      return { output: modelResult.error, isError: true };
    }
    const model = modelResult;

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
};
