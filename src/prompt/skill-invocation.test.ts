import { describe, expect, test } from "bun:test";
import { composeSkillInvocation } from "./skill-invocation.ts";

describe("composeSkillInvocation", () => {
  test("composes the command-name/command-args/instructions template with args", () => {
    const result = composeSkillInvocation(
      { name: "review", content: "# Review skill\n\nDo a careful review." },
      "--focus security",
    );
    expect(result).toBe(
      "<command-name>/review</command-name>\n" +
        "<command-args>--focus security</command-args>\n" +
        "The operator invoked the /review slash command. Follow the skill's instructions below.\n\n" +
        "# Review skill\n\nDo a careful review.",
    );
  });

  test("renders an empty command-args block when args is undefined", () => {
    const result = composeSkillInvocation({ name: "help", content: "content body" }, undefined);
    expect(result).toContain("<command-args></command-args>");
    expect(result).toContain("<command-name>/help</command-name>");
    expect(result).toContain(
      "The operator invoked the /help slash command. Follow the skill's instructions below.",
    );
    expect(result.endsWith("content body")).toBe(true);
  });
});
