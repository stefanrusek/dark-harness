// Skill discovery/loading — scans dh.json's skillPaths for `<name>/SKILL.md` (Claude Code
// convention, per HANDOFF.md §5). Used by the Skill tool's ctx.loadSkill.
//
// DH-0016 fix (tracking/DH-0016-skill-system-loading-and-discovery-gaps.md), cross-domain with
// Prompt (discovery/enumeration lives in src/prompt/skills.ts; loading lives here):
//
// 1. The bundled `cli-tools` skill's body was embedded at compile time only into
//    src/prompt/system-prompt.ts (for enumeration in the system prompt) — this module, which
//    is what the `Skill` tool actually calls, had no on-disk path for it at all, so
//    `Skill(skill: "cli-tools")` always returned "not found" despite the prompt telling the
//    model it's available. Fixed by importing the same bundled SKILL.md text here too (a data
//    asset, not owned logic — importing it from two places doesn't violate directory
//    ownership) and special-casing it before the on-disk scan.
// 2. Directory/frontmatter name mismatch: discovery (src/prompt/skills.ts) keys skills by their
//    frontmatter `name`, but this module used to key purely by directory name
//    (`join(base, name, "SKILL.md")`), so a skill directory whose name differs from its
//    frontmatter `name` would be discoverable (enumerated in the prompt) but not loadable (the
//    `Skill` tool couldn't find it under either name). Fixed by scanning each skillPaths
//    directory's entries and matching by parsed frontmatter `name`, the same key discovery
//    uses, with a console warning when a directory's own name doesn't match its frontmatter's.
// 3. Name collisions (two on-disk skills sharing a name, or a configured skill named
//    "cli-tools") are resolved deterministically — first match wins, in skillPaths order, with
//    the builtin `cli-tools` skill checked first (so an operator can't accidentally shadow the
//    reference material the system prompt already promises is available) — logged via a
//    console warning so the collision isn't silently invisible.
// 4. Malformed/unparseable SKILL.md frontmatter is logged (console.warn) instead of the skill
//    just silently vanishing from consideration — consistent with the project's own "no silent
//    truncation" discipline (CLAUDE.md §8).
// 5. Skill names are checked for path-traversal segments (`/`, `\`, `..`) before ever being
//    joined into a filesystem path — minor given the "everything is allowed" permission model,
//    but keeps the tool's actual behavior matching its documented scope (a name, not a path).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import CLI_TOOLS_SKILL_MD from "../prompt/skills/cli-tools/SKILL.md" with { type: "text" };
import { parseSkillFrontmatter, type Skill } from "../prompt/skills.ts";

export interface LoadedSkill {
  name: string;
  path: string;
  content: string;
}

const BUILTIN_CLI_TOOLS_NAME = "cli-tools";

/** DH-0093: the builtin `cli-tools` skill, synthesized into the same `Skill` shape
 * `discoverSkills()` (src/prompt/skills.ts) produces for on-disk skills — used by
 * `AgentRuntime`'s `listSkills()` to prepend the builtin ahead of the eager `discoverSkills()`
 * scan (which only ever sees `skillPaths`, never this bundled skill). Parses the same
 * frontmatter discovery already relies on, so its description can never drift out of sync
 * with the SKILL.md content actually loaded/invoked. Malformed builtin frontmatter (should
 * never happen — it ships with the binary) falls back to an empty description rather than
 * throwing at import time. */
export const BUILTIN_CLI_TOOLS_SKILL: Skill = Object.freeze({
  name: BUILTIN_CLI_TOOLS_NAME,
  description: parseSkillFrontmatter(CLI_TOOLS_SKILL_MD)?.description ?? "",
  source: "builtin",
});

/** True if `name` contains anything that could escape a simple `join(base, name, ...)` join —
 * a path separator or a `..` traversal segment. `Skill`'s documented scope is "the skill's
 * directory name", never a path, so this is rejected outright rather than silently resolved. */
function looksLikePathTraversal(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name === "." || name === "..";
}

async function scanSkillPathsFor(
  targetName: string,
  skillPaths: string[],
  options?: { warnIfShadowsBuiltin?: boolean },
): Promise<LoadedSkill | null> {
  for (const base of skillPaths) {
    const entries = await readdir(base).catch(() => null);
    if (entries === null) continue;

    for (const entry of entries) {
      const skillDir = join(base, entry);
      const stats = await stat(skillDir).catch(() => null);
      if (stats === null || !stats.isDirectory()) continue;

      const skillMdPath = join(skillDir, "SKILL.md");
      const content = await Bun.file(skillMdPath)
        .text()
        .catch(() => null);
      if (content === null) continue;

      const parsed = parseSkillFrontmatter(content);
      if (parsed === null) {
        console.warn(
          `dh: skill directory "${skillDir}" has missing or malformed SKILL.md frontmatter; skipped.`,
        );
        continue;
      }

      if (parsed.name !== entry) {
        console.warn(
          `dh: skill directory "${skillDir}" is named "${entry}" but its SKILL.md frontmatter ` +
            `declares name "${parsed.name}"; loading/matching uses the frontmatter name.`,
        );
      }

      if (options?.warnIfShadowsBuiltin && parsed.name === BUILTIN_CLI_TOOLS_NAME) {
        console.warn(
          `dh: skill directory "${skillDir}" declares the reserved name "${BUILTIN_CLI_TOOLS_NAME}"; the builtin skill of that name always takes precedence and this on-disk one is unreachable via the Skill tool.`,
        );
      }

      if (parsed.name === targetName) {
        return { name: parsed.name, path: skillMdPath, content };
      }
    }
  }
  return null;
}

export async function loadSkillFromPaths(
  name: string,
  skillPaths: string[],
): Promise<LoadedSkill | null> {
  if (looksLikePathTraversal(name)) {
    console.warn(`dh: Skill tool refused a name containing path segments: ${JSON.stringify(name)}`);
    return null;
  }

  if (name === BUILTIN_CLI_TOOLS_NAME) {
    return { name: BUILTIN_CLI_TOOLS_NAME, path: "builtin", content: CLI_TOOLS_SKILL_MD };
  }

  // The `name === BUILTIN_CLI_TOOLS_NAME` branch above already intercepts any request for
  // "cli-tools" before reaching here, so a configured skillPaths entry also named "cli-tools"
  // is unreachable via this function — surfaced as a warning during the scan itself so an
  // operator who added one isn't left wondering why it never loads.
  return scanSkillPathsFor(name, skillPaths, { warnIfShadowsBuiltin: true });
}
