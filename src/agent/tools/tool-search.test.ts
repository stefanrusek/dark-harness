import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";
import { toolSearchTool } from "./tool-search.ts";

describe("ToolSearch tool", () => {
  test("returns matches formatted as name: description", async () => {
    const ctx = makeToolContext({
      searchDeferredTools: () => [{ name: "mcp__github__*", description: "GitHub tools" }],
    });
    const result = await toolSearchTool.execute({ query: "git" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("mcp__github__*: GitHub tools");
  });

  test("reports no matches clearly", async () => {
    const ctx = makeToolContext({ searchDeferredTools: () => [] });
    const result = await toolSearchTool.execute({ query: "nonexistent" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('No deferred tools matched "nonexistent"');
  });

  test("rejects a non-string query", async () => {
    const ctx = makeToolContext();
    const result = await toolSearchTool.execute({ query: 5 }, ctx);
    expect(result.isError).toBe(true);
  });
});
