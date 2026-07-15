// Skill discovery: scans `dh.json` `skillPaths` directories for the Claude Code skill
// convention (a directory containing a `SKILL.md` with YAML frontmatter carrying at least
// `name` and `description`). Only those two fields are consumed here — the rest of the
// file's body is the skill's instructional content, loaded on demand elsewhere (by the
// `Skill` tool, Core's territory) when an agent actually invokes it by name.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** A skill available for enumeration in the system prompt. */
export interface Skill {
  name: string;
  description: string;
  /** Directory the skill was discovered in, or `"builtin"` for the bundled cli-tools skill. */
  source: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const FIELD_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;

/**
 * Parses the YAML-ish frontmatter block at the top of a SKILL.md file and extracts `name`
 * and `description`. Deliberately not a full YAML parser: every skill observed in practice
 * (this project's own bundled skill included) uses flat, single-line `key: value` fields,
 * optionally double-quoted. Returns `null` if the file has no frontmatter block or is
 * missing either required field.
 */
export function parseSkillFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const match = content.match(FRONTMATTER_PATTERN);
  const frontmatter = match?.[1];
  if (frontmatter === undefined) return null;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const fieldMatch = line.match(FIELD_PATTERN);
    const key = fieldMatch?.[1];
    const rawValue = fieldMatch?.[2];
    if (key === undefined || rawValue === undefined) continue;
    fields[key] = unquote(rawValue.trim());
  }

  const { name, description } = fields;
  if (!name || !description) return null;
  return { name, description };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return value;
}

/**
 * Scans each directory in `skillPaths` for immediate subdirectories containing a `SKILL.md`,
 * parsing each one's frontmatter. Missing/unreadable `skillPaths` entries, non-directory
 * entries, and skill directories with no (or malformed) `SKILL.md` are skipped gracefully
 * rather than failing the whole scan — a single bad skill directory should never take down
 * prompt loading.
 */
export async function discoverSkills(skillPaths: readonly string[] | undefined): Promise<Skill[]> {
  const skills: Skill[] = [];

  for (const dir of skillPaths ?? []) {
    const entries = await readdir(dir).catch(() => null);
    if (entries === null) continue;

    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const stats = await stat(skillDir).catch(() => null);
      if (stats === null || !stats.isDirectory()) continue;

      const content = await Bun.file(join(skillDir, "SKILL.md"))
        .text()
        .catch(() => null);
      if (content === null) continue;

      const parsed = parseSkillFrontmatter(content);
      if (parsed === null) continue;

      skills.push({ ...parsed, source: skillDir });
    }
  }

  return skills;
}
