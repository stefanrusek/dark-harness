import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillFromPaths } from "./skills.ts";

let dir: string;
let warnSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-skills-test-"));
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  warnSpy.mockRestore();
});

function skillMd(name: string, description = "does things"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`;
}

describe("loadSkillFromPaths", () => {
  test("finds a SKILL.md in the first matching skillPath", async () => {
    await Bun.write(join(dir, "greet", "SKILL.md"), skillMd("greet", "Say hello."));
    const skill = await loadSkillFromPaths("greet", [dir]);
    expect(skill).not.toBeNull();
    expect(skill?.content).toContain("Say hello.");
    expect(skill?.name).toBe("greet");
  });

  test("searches subsequent skillPaths when earlier ones don't have the skill", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "dh-skills-test-other-"));
    try {
      await Bun.write(join(otherDir, "greet", "SKILL.md"), skillMd("greet", "found in second path"));
      const skill = await loadSkillFromPaths("greet", [dir, otherDir]);
      expect(skill?.content).toContain("found in second path");
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  test("returns null when no skillPath has the skill", async () => {
    const skill = await loadSkillFromPaths("missing", [dir]);
    expect(skill).toBeNull();
  });

  test("returns null when skillPaths is empty", async () => {
    const skill = await loadSkillFromPaths("anything", []);
    expect(skill).toBeNull();
  });

  test("DH-0016: cli-tools loads the bundled builtin skill even with no skillPaths", async () => {
    const skill = await loadSkillFromPaths("cli-tools", []);
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("cli-tools");
    expect(skill?.content).toContain("CLI tools reference");
  });

  test("DH-0016: cli-tools always resolves to the builtin, never a configured shadow", async () => {
    await Bun.write(join(dir, "cli-tools", "SKILL.md"), skillMd("cli-tools", "shadow attempt"));
    const skill = await loadSkillFromPaths("cli-tools", [dir]);
    expect(skill?.content).toContain("CLI tools reference");
    expect(skill?.content).not.toContain("shadow attempt");
  });

  test("DH-0016: matches by frontmatter name, reconciling a directory/name mismatch", async () => {
    await Bun.write(join(dir, "some-dir", "SKILL.md"), skillMd("real-name"));
    const skill = await loadSkillFromPaths("real-name", [dir]);
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("real-name");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("DH-0016: warns and skips a directory with malformed frontmatter", async () => {
    await Bun.write(join(dir, "broken", "SKILL.md"), "no frontmatter here at all");
    const skill = await loadSkillFromPaths("broken", [dir]);
    expect(skill).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("DH-0016: refuses a name containing path-traversal segments", async () => {
    const skill = await loadSkillFromPaths("../../etc/passwd", [dir]);
    expect(skill).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("DH-0016: refuses a name containing a path separator", async () => {
    const skill = await loadSkillFromPaths("foo/bar", [dir]);
    expect(skill).toBeNull();
  });
});
