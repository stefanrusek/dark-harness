// Skill tool — loads a skill by name from configured skillPaths (HANDOFF.md §4, §5).

import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const skillTool: Tool = {
  name: "Skill",
  description:
    "Load a skill by name from the configured skillPaths (each a directory containing SKILL.md).",
  inputSchema: {
    type: "object",
    properties: {
      skill: { type: "string", description: "The skill's directory name." },
    },
    required: ["skill"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const skill = input.skill;
    if (typeof skill !== "string" || skill.length === 0) {
      return { output: "Skill tool error: 'skill' must be a non-empty string.", isError: true };
    }

    const loaded = await ctx.loadSkill(skill);
    if (!loaded) {
      return {
        output: `Skill tool error: no skill named "${skill}" found in configured skillPaths.`,
        isError: true,
      };
    }

    return { output: loaded.content, isError: false };
  },
};
