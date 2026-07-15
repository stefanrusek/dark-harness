import { describe, expect, test } from "bun:test";
import { searchConfiguredMcpTools } from "./mcp.ts";

describe("searchConfiguredMcpTools", () => {
  test("returns empty when no mcpServers configured", () => {
    expect(searchConfiguredMcpTools(undefined, "anything")).toEqual([]);
  });

  test("returns a descriptor per configured server matching the query", () => {
    const results = searchConfiguredMcpTools(
      { github: { command: "gh-mcp" }, drive: { url: "https://example.com/mcp" } },
      "git",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("mcp__github__*");
    expect(results[0]?.description).toContain("stdio");
  });

  test("empty query returns every configured server", () => {
    const results = searchConfiguredMcpTools(
      { github: { command: "gh-mcp" }, drive: { url: "https://example.com/mcp" } },
      "",
    );
    expect(results).toHaveLength(2);
  });

  test("marks HTTP servers distinctly from stdio servers", () => {
    const results = searchConfiguredMcpTools(
      { drive: { url: "https://example.com/mcp" } },
      "drive",
    );
    expect(results[0]?.description).toContain("http");
  });

  test("query with no matches returns an empty array", () => {
    const results = searchConfiguredMcpTools({ github: { command: "gh-mcp" } }, "nonexistent");
    expect(results).toEqual([]);
  });
});
