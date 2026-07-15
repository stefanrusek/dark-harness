import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillFromPaths } from "./skills.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-skills-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadSkillFromPaths", () => {
  test("finds a SKILL.md in the first matching skillPath", async () => {
    await Bun.write(join(dir, "greet", "SKILL.md"), "# Greet\nSay hello.");
    const skill = await loadSkillFromPaths("greet", [dir]);
    expect(skill).not.toBeNull();
    expect(skill?.content).toContain("Say hello.");
    expect(skill?.name).toBe("greet");
  });

  test("searches subsequent skillPaths when earlier ones don't have the skill", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "dh-skills-test-other-"));
    try {
      await Bun.write(join(otherDir, "greet", "SKILL.md"), "found in second path");
      const skill = await loadSkillFromPaths("greet", [dir, otherDir]);
      expect(skill?.content).toBe("found in second path");
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
});
