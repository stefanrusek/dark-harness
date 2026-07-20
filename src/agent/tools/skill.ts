// Skill tool — loads a skill by name from configured skillPaths (HANDOFF.md §4, §5).

import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

export const skillTool: Tool = Object.freeze<Tool>({
  name: "Skill",
  description:
    "Load a skill by name from the configured skillPaths (each a directory containing SKILL.md). " +
    "Optionally pass 'args' to pass arguments through to the skill.",
  inputSchema: {
    type: "object",
    properties: {
      skill: { type: "string", description: "The skill's directory name." },
      args: {
        type: "string",
        description: "Optional arguments passed through to the skill, appended to its content.",
      },
    },
    required: ["skill"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    // 'args' keeps its own local check — its "must be a string when provided." wording
    // differs from the shared helper's "must be a string.", so only 'skill' is scoped in.
    const validation = validateInput(
      {
        type: "object",
        properties: { skill: skillTool.inputSchema.properties.skill },
        required: ["skill"],
      },
      "Skill",
      input,
    );
    if (!validation.ok) return validation.result;
    const skill = input.skill as string;

    const args = input.args;
    if (args !== undefined && typeof args !== "string") {
      return { output: "Skill tool error: 'args' must be a string when provided.", isError: true };
    }

    const loaded = await ctx.loadSkill(skill);
    if (!loaded) {
      return {
        output: `Skill tool error: no skill named "${skill}" found in configured skillPaths.`,
        isError: true,
      };
    }

    // Round 13 (docs/handoffs/core.md, P2 item 11): surface the caller's args alongside the
    // skill's own content rather than trying to interpolate them into SKILL.md — the skill
    // itself decides how (or whether) to use them, same as Claude Code's own Skill tool.
    const output =
      args !== undefined
        ? `${loaded.content}\n\n<skill-args>\n${args}\n</skill-args>`
        : loaded.content;

    return { output, isError: false };
  },
});
