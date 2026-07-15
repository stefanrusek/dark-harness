import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, parseSkillFrontmatter } from "./skills.ts";

describe("parseSkillFrontmatter", () => {
  test("parses simple unquoted fields", () => {
    const content = ["---", "name: foo", "description: does foo things", "---", "", "# Foo"].join(
      "\n",
    );
    expect(parseSkillFrontmatter(content)).toEqual({
      name: "foo",
      description: "does foo things",
    });
  });

  test("parses double-quoted fields with escaped quotes and backslashes", () => {
    const content = [
      "---",
      'name: "quoted-skill"',
      'description: "Handles \\"quoted\\" phrases and back\\\\slashes."',
      "license: MIT",
      "---",
      "body",
    ].join("\n");
    expect(parseSkillFrontmatter(content)).toEqual({
      name: "quoted-skill",
      description: 'Handles "quoted" phrases and back\\slashes.',
    });
  });

  test("ignores extra fields and blank/malformed lines within the block", () => {
    const content = [
      "---",
      "",
      "not a field line without a colon-space pattern that matches====",
      "name: bar",
      "description: does bar things",
      "compatibility: everywhere",
      "---",
      "body",
    ].join("\n");
    expect(parseSkillFrontmatter(content)).toEqual({
      name: "bar",
      description: "does bar things",
    });
  });

  test("returns null when there is no frontmatter block", () => {
    expect(parseSkillFrontmatter("# Just a heading\n\nno frontmatter here")).toBeNull();
  });

  test("returns null when name is missing", () => {
    const content = ["---", "description: missing a name", "---"].join("\n");
    expect(parseSkillFrontmatter(content)).toBeNull();
  });

  test("returns null when description is missing", () => {
    const content = ["---", "name: no-description", "---"].join("\n");
    expect(parseSkillFrontmatter(content)).toBeNull();
  });
});

describe("discoverSkills", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dh-skills-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSkill(dir: string, name: string, description: string): Promise<void> {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`,
    );
  }

  test("returns an empty array when skillPaths is undefined", async () => {
    expect(await discoverSkills(undefined)).toEqual([]);
  });

  test("returns an empty array when skillPaths is empty", async () => {
    expect(await discoverSkills([])).toEqual([]);
  });

  test("discovers a well-formed skill", async () => {
    await writeSkill(root, "alpha", "the alpha skill");
    const skills = await discoverSkills([root]);
    expect(skills).toEqual([
      { name: "alpha", description: "the alpha skill", source: join(root, "alpha") },
    ]);
  });

  test("discovers multiple skills across multiple skillPaths directories", async () => {
    const other = await mkdtemp(join(tmpdir(), "dh-skills-other-"));
    try {
      await writeSkill(root, "alpha", "the alpha skill");
      await writeSkill(other, "beta", "the beta skill");
      const skills = await discoverSkills([root, other]);
      expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  test("skips a missing skillPaths directory", async () => {
    expect(await discoverSkills([join(root, "does-not-exist")])).toEqual([]);
  });

  test("skips non-directory entries in a skillPaths directory", async () => {
    await writeFile(join(root, "not-a-dir.txt"), "hello");
    expect(await discoverSkills([root])).toEqual([]);
  });

  test("skips a skill directory with no SKILL.md", async () => {
    await mkdir(join(root, "no-skill-file"), { recursive: true });
    expect(await discoverSkills([root])).toEqual([]);
  });

  test("skips a skill directory whose SKILL.md has malformed frontmatter", async () => {
    const skillDir = join(root, "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "no frontmatter at all here");
    expect(await discoverSkills([root])).toEqual([]);
  });

  test("skips an entry that disappears/fails to stat (e.g. a dangling symlink)", async () => {
    await symlink(join(root, "does-not-exist-target"), join(root, "dangling"));
    expect(await discoverSkills([root])).toEqual([]);
  });
});
