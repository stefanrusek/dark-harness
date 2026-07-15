import { describe, expect, test } from "bun:test";
import { mcpAuthTool } from "./mcp-auth.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("McpAuth tool (stub)", () => {
  test("always reports not-implemented for a valid server name", async () => {
    const ctx = makeToolContext();
    const result = await mcpAuthTool.execute({ server: "github" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not implemented");
    expect(result.output).toContain("github");
  });

  test("rejects a missing server name", async () => {
    const ctx = makeToolContext();
    const result = await mcpAuthTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'server'");
  });
});
