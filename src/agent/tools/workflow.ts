// Workflow tool (DH-0226) — runs a checked-in, trusted orchestration script that coordinates
// ad-hoc sub-agents with real control flow (agent(), parallel()) instead of turn-by-turn model
// judgment. Peer of the Agent tool (ALL_TOOLS, tools/index.ts). Execution model: in-process
// dynamic `import()` of a cwd-relative script file — explicitly NOT `new Function`/`eval` (ADR
// 0004's trusted in-process execution posture; ADR 0009's invariant-8 scoping). MVP: no
// pipeline()/schema/resumability/phase()/SSE/`/workflow` command — see the ticket's Non-goals.

import path from "node:path";
import { buildWorkflowApi } from "../workflow/runner.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

export const workflowTool: Tool = Object.freeze<Tool>({
  name: "Workflow",
  description:
    "Run a deterministic orchestration script that coordinates ad-hoc sub-agents with real " +
    "control flow (agent(), parallel()) instead of turn-by-turn model judgment. `script` is a " +
    "path (relative to cwd) to a .ts/.js module whose default export is `async (wf, input) => " +
    "any`.",
  inputSchema: {
    type: "object",
    properties: {
      script: { type: "string", description: "Path to the workflow script, relative to cwd." },
      input: { type: "object", description: "Optional JSON passed as the script's second arg." },
    },
    required: ["script"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const validation = validateInput(workflowTool.inputSchema, "Workflow", input);
    if (!validation.ok) return validation.result;

    const scriptPath = input.script as string;
    const scriptInput = (input.input as Record<string, unknown> | undefined) ?? {};
    const resolvedPath = path.resolve(ctx.cwd, scriptPath);

    let mod: Record<string, unknown>;
    try {
      mod = (await import(resolvedPath)) as Record<string, unknown>;
    } catch (err) {
      return {
        output: `Workflow tool error: could not import script "${scriptPath}" (resolved to ${resolvedPath}): ${(err as Error).message}`,
        isError: true,
      };
    }

    const defaultExport = mod.default;
    if (typeof defaultExport !== "function") {
      return {
        output: `Workflow tool error: script "${scriptPath}" must have a default export function (async (wf, input) => any).`,
        isError: true,
      };
    }

    const { api, drainLog } = buildWorkflowApi(ctx);
    try {
      const result = (await (defaultExport as (api: unknown, scriptInput: unknown) => unknown)(
        api,
        scriptInput,
      )) as unknown;
      const log = drainLog();
      const output = String(result ?? "");
      return { output: log.length > 0 ? `${output}\n${log}` : output, isError: false };
    } catch (err) {
      return {
        output: `Workflow tool error: script "${scriptPath}" threw: ${(err as Error).message}`,
        isError: true,
      };
    }
  },
});
