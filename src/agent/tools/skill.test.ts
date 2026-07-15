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

  // Round 13 (docs/handoffs/core.md, P2 item 11): optional args passed through to the skill.
  describe("args (Round 13)", () => {
    test("appends args alongside the skill's content when provided", async () => {
      const ctx = makeToolContext({
        loadSkill: async (name) => ({
          name,
          path: `/skills/${name}/SKILL.md`,
          content: "skill body",
        }),
      });
      const result = await skillTool.execute({ skill: "greet", args: "--loud" }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("skill body");
      expect(result.output).toContain("<skill-args>\n--loud\n</skill-args>");
    });

    test("omits the skill-args block entirely when args is not provided", async () => {
      const ctx = makeToolContext({
        loadSkill: async (name) => ({
          name,
          path: `/skills/${name}/SKILL.md`,
          content: "skill body",
        }),
      });
      const result = await skillTool.execute({ skill: "greet" }, ctx);
      expect(result.output).toBe("skill body");
    });

    test("rejects a non-string args", async () => {
      const ctx = makeToolContext();
      const result = await skillTool.execute({ skill: "greet", args: 5 }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("'args'");
    });
  });
});
