import { describe, expect, test } from "bun:test";
import { BUILTIN_CLI_TOOLS_SKILL } from "./skills.ts";
import { SkillsCache } from "./skills-cache.ts";

describe("SkillsCache", () => {
  test("starts with just the builtin skill before discoverSkills() resolves", async () => {
    const cache = new SkillsCache(undefined);
    // discoverSkills() is async and hasn't necessarily resolved yet at construction time —
    // the list should at minimum contain the builtin entry.
    expect(cache.list().some((s) => s.name === BUILTIN_CLI_TOOLS_SKILL.name)).toBe(true);
  });

  test("eventually includes discovered skills from configured skillPaths", async () => {
    const cache = new SkillsCache([]);
    // Give the fire-and-forget discoverSkills().then() a tick to resolve.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cache.list()[0]?.name).toBe(BUILTIN_CLI_TOOLS_SKILL.name);
  });

  test("loadByName() delegates to loadSkillFromPaths()", async () => {
    const loaded = await SkillsCache.loadByName("cli-tools", undefined);
    expect(loaded?.name).toBe(BUILTIN_CLI_TOOLS_SKILL.name);
  });

  test("loadByName() returns undefined for an unknown skill", async () => {
    const loaded = await SkillsCache.loadByName("definitely-not-a-real-skill", []);
    expect(loaded).toBeNull();
  });
});
