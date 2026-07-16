import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { makeToolContext } from "../tools/test-helpers.ts";
import { McpManager } from "./manager.ts";
import { buildMcpTool, buildMcpTools, mcpToolName } from "./tools.ts";

const FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/fake-stdio-server.ts", import.meta.url));
const GOOD_SERVER = { command: process.execPath, args: ["run", FIXTURE_PATH] };

describe("mcpToolName", () => {
  test("names as mcp__<server>__<tool>", () => {
    expect(mcpToolName("github", "create_issue")).toBe("mcp__github__create_issue");
  });
});

function findTool(tools: ReturnType<typeof buildMcpTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`test fixture missing expected tool "${name}"`);
  return tool;
}

describe("buildMcpTool / buildMcpTools", () => {
  test("adapts a discovered tool into the Tool interface with deferred: true", async () => {
    const manager = new McpManager({ good: GOOD_SERVER });
    await manager.connectAll();
    const tools = buildMcpTools(manager);
    const echo = tools.find((t) => t.name === "mcp__good__echo");
    expect(echo).toBeDefined();
    expect(echo?.deferred).toBe(true);
    expect(echo?.inputSchema.type).toBe("object");
    await manager.close();
  });

  test("execute() concatenates text content on success", async () => {
    const manager = new McpManager({ good: GOOD_SERVER });
    await manager.connectAll();
    const tools = buildMcpTools(manager);
    const echo = findTool(tools, "mcp__good__echo");
    const ctx = makeToolContext();
    const result = await echo.execute({ text: "hi there" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("echo: hi there");
    await manager.close();
  });

  test("execute() maps MCP isError to ToolResult.isError", async () => {
    const manager = new McpManager({ good: GOOD_SERVER });
    await manager.connectAll();
    const tools = buildMcpTools(manager);
    const fail = findTool(tools, "mcp__good__fail");
    const ctx = makeToolContext();
    const result = await fail.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("boom");
    await manager.close();
  });

  test("execute() maps a thrown timeout/connection error into ToolResult { isError: true }", async () => {
    const manager = new McpManager({ good: { ...GOOD_SERVER, timeoutMs: 200 } });
    await manager.connectAll();
    const tools = buildMcpTools(manager);
    const slow = findTool(tools, "mcp__good__slow");
    const ctx = makeToolContext();
    const result = await slow.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("good");
    expect(result.output).toContain("slow");
    await manager.close();
  });

  test("non-text content blocks are JSON-encoded with a [type: X] note", async () => {
    const manager = new McpManager({ good: GOOD_SERVER });
    await manager.connectAll();
    const echoDescriptor = manager.listAllTools().tools.find((t) => t.name === "echo");
    if (!echoDescriptor) throw new Error('test fixture missing expected descriptor "echo"');
    const tool = buildMcpTool(manager, echoDescriptor);
    // Force a non-text-shaped result by calling the manager directly through a stubbed
    // manager-like object isn't necessary — instead exercise the adapter's non-text branch
    // via a fake manager whose callTool returns a non-text block.
    const fakeManager = {
      callTool: async () => ({ content: [{ type: "image", data: "base64...", isError: false }] }),
    } as unknown as McpManager;
    const tool2 = buildMcpTool(fakeManager, echoDescriptor);
    const result = await tool2.execute({}, makeToolContext());
    expect(result.output).toContain("[type: image]");
    expect(result.isError).toBe(false);
    expect(tool).toBeDefined();
    await manager.close();
  });

  test("a tool with no description gets a fallback description", async () => {
    const manager = new McpManager({});
    const descriptor = {
      serverName: "s",
      name: "n",
      description: "",
      inputSchema: { type: "object" as const },
    };
    const tool = buildMcpTool(manager, descriptor);
    expect(tool.description).toContain("MCP tool");
    await manager.close();
  });

  test("a call returning no content blocks reports a clear placeholder, not empty output", async () => {
    const fakeManager = { callTool: async () => ({}) } as unknown as McpManager;
    const descriptor = {
      serverName: "s",
      name: "n",
      description: "d",
      inputSchema: { type: "object" as const },
    };
    const tool = buildMcpTool(fakeManager, descriptor);
    const result = await tool.execute({}, makeToolContext());
    expect(result.output).toContain("no content");
  });
});
