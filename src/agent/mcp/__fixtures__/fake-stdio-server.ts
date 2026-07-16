// Test-only fixture (DH-0002): a tiny real MCP server speaking stdio JSON-RPC, spawned by
// connection.test.ts / manager.test.ts as a `command`-configured McpServerConfig, so tests
// exercise the real StdioClientTransport wire path rather than mocking it away. Uses the
// MCP SDK's *server* half deliberately — that "never import the server half" constraint
// applies to product code (src/agent/mcp/*), not to a test fixture standing in for someone
// else's real MCP server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "dh-fake-fixture", version: "0.1.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes back the given text.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);

server.registerTool(
  "fail",
  {
    description: "Always returns an MCP-level tool error.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
);

server.registerTool(
  "slow",
  {
    description: "Never responds within any reasonable per-call timeout.",
    inputSchema: {},
  },
  () => new Promise(() => {}),
);

await server.connect(new StdioServerTransport());
