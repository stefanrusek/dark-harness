import { describe, expect, test } from "bun:test";
import type { DhConfig } from "../../contracts/index.ts";
import { ALL_TOOLS, buildToolMap, composeTools } from "./index.ts";

const BASE_CONFIG: DhConfig = {
  options: { defaultModel: "sonnet" },
  models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
  provider: [{ name: "anthropic", type: "anthropic" }],
};

describe("tool registry", () => {
  test("exposes exactly the 19 tools (HANDOFF.md §4's original 12, DH-0054's Grep/Glob, DH-0073's NotebookEdit, DH-0076's Todo family)", () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "Agent",
        "Bash",
        "Edit",
        "Glob",
        "Grep",
        "McpAuth",
        "Monitor",
        "NotebookEdit",
        "Read",
        "SendMessage",
        "Skill",
        "TaskOutput",
        "TaskStop",
        "TodoCreate",
        "TodoGet",
        "TodoList",
        "TodoUpdate",
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

describe("composeTools (DH-0074)", () => {
  test("web absent entirely -> exactly ALL_TOOLS, no WebFetch/WebSearch", () => {
    const tools = composeTools(BASE_CONFIG);
    expect(tools).toHaveLength(ALL_TOOLS.length);
    expect(tools.some((t) => t.name === "WebFetch")).toBe(false);
    expect(tools.some((t) => t.name === "WebSearch")).toBe(false);
  });

  test("web present but both sub-blocks absent -> still no WebFetch/WebSearch", () => {
    const tools = composeTools({ ...BASE_CONFIG, web: {} });
    expect(tools).toHaveLength(ALL_TOOLS.length);
  });

  test("web.fetch present -> registers WebFetch only", () => {
    const tools = composeTools({ ...BASE_CONFIG, web: { fetch: {} } });
    expect(tools.some((t) => t.name === "WebFetch")).toBe(true);
    expect(tools.some((t) => t.name === "WebSearch")).toBe(false);
    expect(tools).toHaveLength(ALL_TOOLS.length + 1);
  });

  test("web.search present -> registers WebSearch only", () => {
    const tools = composeTools({
      ...BASE_CONFIG,
      web: { search: { provider: "brave", apiKey: "key" } },
    });
    expect(tools.some((t) => t.name === "WebSearch")).toBe(true);
    expect(tools.some((t) => t.name === "WebFetch")).toBe(false);
    expect(tools).toHaveLength(ALL_TOOLS.length + 1);
  });

  test("both web.fetch and web.search present -> registers both, independently", () => {
    const tools = composeTools({
      ...BASE_CONFIG,
      web: { fetch: {}, search: { provider: "brave", apiKey: "key" } },
    });
    expect(tools.some((t) => t.name === "WebFetch")).toBe(true);
    expect(tools.some((t) => t.name === "WebSearch")).toBe(true);
    expect(tools).toHaveLength(ALL_TOOLS.length + 2);
  });
});
