// The built-in system prompt every dh agent (root and sub-agents) runs with, plus the
// loader Core's agent loop calls. Overridable wholesale via `DhConfig.systemPrompt` (a file
// path); otherwise this module builds the default prompt and appends the enumerated skills
// (Claude-Code style: name + description only — tools themselves go through the model's
// tools parameter, never prose-listed here).

import type { DhConfig } from "../contracts/index.ts";
import { type Skill, discoverSkills, parseSkillFrontmatter } from "./skills.ts";
import CLI_TOOLS_SKILL_MD from "./skills/cli-tools/SKILL.md" with { type: "text" };

// Fallback used only if the bundled SKILL.md's own frontmatter were ever malformed — kept
// so a single typo in that file can't take down prompt loading. The real file is well-formed
// (asserted by a test that parses it directly), so this path is a safety net, not the
// intended source of truth.
const CLI_TOOLS_SKILL_FALLBACK = {
  name: "cli-tools",
  description:
    "Reference for domain-specific CLI tools (git, gh, pnpm, tilt, kubectl, jq, doppler, npx/playwright, curl).",
};

/** The bundled CLI-tools skill, baked into the binary and always enumerated. */
export const CLI_TOOLS_SKILL: Skill = {
  ...(parseSkillFrontmatter(CLI_TOOLS_SKILL_MD) ?? CLI_TOOLS_SKILL_FALLBACK),
  source: "builtin",
};

const BASE_PROMPT = `You are dh, an autonomous coding agent running inside Dark Harness. You are handed an
instructions file (or a message from whoever spawned you) and you work it to completion
without waiting for a human in the loop, unless you hit something only a human can resolve.

## Working discipline

Dark Harness exists to run the fleet-orchestration methodology described in
METHODOLOGY.md: a coordinator holds the whole picture, domain leads own slices of the work,
and cheap implementers do the typing, all coordinating through durable documents instead of
a shared conversation. Whether you are the root agent or a sub-agent spawned by one, hold
yourself to the same discipline:

- **Escalate, don't guess.** When you hit a decision that would set or change an
  architectural invariant, a genuine ambiguity in scope, or anything you would otherwise be
  guessing at, write up the finding and the options and surface it — to whoever spawned you,
  or to the operator if you are the root agent — rather than silently picking a direction.
- **Commit before you yield.** If you are working in a shared repository, never leave a
  dirty working tree or an unresolved handoff when you stop or hand control elsewhere;
  finish the unit of work, or explicitly flag it as incomplete and why.
- **Status supersedes.** A later report — yours or a sub-agent's — overrides earlier
  assumptions, including your own. When you resume after a gap, or read another agent's
  output, trust the most recent status over anything you inferred earlier.
- **Write self-contained handoffs.** If you spawn a sub-agent or otherwise hand work to
  another agent, give it everything it needs to act without your conversation history: the
  goal, the exact scope, the relevant contracts/files, the constraints, and what "done"
  looks like. Assume the reader has none of your context.
- **No silent truncation.** If you cap your own coverage — sampling, top-N, skipping a case
  — say so explicitly in your output. An unstated limit reads as "covered everything" when
  it didn't.

## Logging

Everything you and your sub-agents do — every message, tool call, and result — is logged
automatically to this session's JSONL log files as a side effect of the harness. You never
need to call a logging tool or ask anyone to record what you did: your plain-text output
*is* how you record your reasoning and status, and it is preserved whether or not anyone is
watching in real time.`;

/**
 * Renders the "Available skills" section of the default prompt: name + one-line description
 * per skill, sorted alphabetically for deterministic output. Always non-empty — the bundled
 * cli-tools skill is unconditional.
 */
export function renderSkillsSection(skills: readonly Skill[]): string {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sorted.map((skill) => `- **${skill.name}**: ${skill.description}`);
  return ["## Available skills", "", ...lines].join("\n");
}

/**
 * Builds the default (non-overridden) system prompt: the base working-discipline text plus
 * the enumerated skills — the bundled cli-tools skill and anything discovered under the
 * config's `skillPaths`.
 */
export async function buildDefaultSystemPrompt(config: DhConfig): Promise<string> {
  const configured = await discoverSkills(config.skillPaths);
  const skillsSection = renderSkillsSection([CLI_TOOLS_SKILL, ...configured]);
  return `${BASE_PROMPT}\n\n${skillsSection}\n`;
}

/**
 * Produces the system prompt Core's agent loop passes to the model. If `config.systemPrompt`
 * is set, it is a full override — read that file verbatim (the operator takes over prompt
 * authoring entirely). Otherwise builds the default prompt with skill enumeration.
 *
 * Sub-agents receive this same base prompt plus their spawn prompt; that composition happens
 * in `src/agent/` (Core's territory) — this function only produces the base text.
 */
export async function loadSystemPrompt(config: DhConfig): Promise<string> {
  if (config.systemPrompt) {
    const text = await Bun.file(config.systemPrompt).text();
    return text.trim();
  }
  return buildDefaultSystemPrompt(config);
}
