// DH-0093: composes the deterministic in-turn expansion for a `/skillname` slash-command
// invocation — matches real Claude Code's convention (a `<command-name>` block folded
// straight into the user turn) rather than relying on the model choosing to call the Skill
// tool itself (see the ticket's design section for the "why option (b)" rationale). Pure
// function, no imports from src/agent/ — Core (src/agent/runtime.ts) imports this, the same
// cross-import precedent as src/agent/skills.ts importing CLI_TOOLS_SKILL_MD from here.

/** The minimal shape composeSkillInvocation needs from a loaded skill — deliberately not the
 * richer `LoadedSkill` (src/agent/skills.ts) type, since this module must not import from
 * src/agent/ at all. */
export interface SkillForInvocation {
  name: string;
  content: string;
}

/**
 * Builds the exact message text delivered into an agent's conversation when the operator
 * types `/<name> [args]`. `args` is `undefined` when the command had none — rendered as an
 * empty `<command-args>` block, not omitted, so the shape is uniform regardless of whether
 * arguments were given.
 */
export function composeSkillInvocation(
  skill: SkillForInvocation,
  args: string | undefined,
): string {
  return `<command-name>/${skill.name}</command-name>\n<command-args>${args ?? ""}</command-args>\nThe operator invoked the /${skill.name} slash command. Follow the skill's instructions below.\n\n${skill.content}`;
}
