// Test-only fixture (DH-0002): a real MCP server whose handshake succeeds but whose
// `tools/list` handler always throws — exercises McpManager's "connected but discovery
// failed" branch (manager.ts's connectAndCache catch path) without needing to race a real
// server's shutdown timing.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "dh-fake-discovery-fail", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  throw new Error("discovery deliberately broken for test");
});

await server.connect(new StdioServerTransport());
