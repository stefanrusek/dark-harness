// Skill discovery/loading — scans dh.json's skillPaths for `<name>/SKILL.md` (Claude Code
// convention, per HANDOFF.md §5). Used by the Skill tool's ctx.loadSkill.

import { join } from "node:path";

export interface LoadedSkill {
  name: string;
  path: string;
  content: string;
}

export async function loadSkillFromPaths(
  name: string,
  skillPaths: string[],
): Promise<LoadedSkill | null> {
  for (const base of skillPaths) {
    const skillMdPath = join(base, name, "SKILL.md");
    const file = Bun.file(skillMdPath);
    if (await file.exists()) {
      const content = await file.text();
      return { name, path: skillMdPath, content };
    }
  }
  return null;
}
