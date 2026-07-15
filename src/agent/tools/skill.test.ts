import { describe, expect, test } from "bun:test";
import { skillTool } from "./skill.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("Skill tool", () => {
  test("returns the skill content on a hit", async () => {
    const ctx = makeToolContext({
      loadSkill: async (name) => ({
        name,
        path: `/skills/${name}/SKILL.md`,
        content: "skill body",
      }),
    });
    const result = await skillTool.execute({ skill: "greet" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("skill body");
  });

  test("errors when the skill isn't found", async () => {
    const ctx = makeToolContext({ loadSkill: async () => null });
    const result = await skillTool.execute({ skill: "missing" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no skill named");
  });

  test("rejects a missing skill name", async () => {
    const ctx = makeToolContext();
    const result = await skillTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects an empty skill name", async () => {
    const ctx = makeToolContext();
    const result = await skillTool.execute({ skill: "" }, ctx);
    expect(result.isError).toBe(true);
  });
});
