import { describe, expect, test } from "bun:test";
import { ALL_TOOLS, buildToolMap } from "./index.ts";

describe("tool registry", () => {
  test("exposes exactly the 12 tools from HANDOFF.md §4", () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "Agent",
        "Bash",
        "Edit",
        "McpAuth",
        "Monitor",
        "Read",
        "SendMessage",
        "Skill",
        "TaskOutput",
        "TaskStop",
        "ToolSearch",
        "Write",
      ].sort(),
    );
  });

  test("buildToolMap indexes tools by name", () => {
    const map = buildToolMap();
    expect(map.get("Bash")?.name).toBe("Bash");
    expect(map.size).toBe(ALL_TOOLS.length);
  });

  test("buildToolMap accepts a custom tool list", () => {
    const [first] = ALL_TOOLS;
    if (!first) throw new Error("expected at least one tool");
    const map = buildToolMap([first]);
    expect(map.size).toBe(1);
  });
});
