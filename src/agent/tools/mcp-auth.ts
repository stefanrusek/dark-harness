// McpAuth tool — handles MCP OAuth flows (HANDOFF.md §4).
//
// STUB for this round (explicitly allowed by docs/handoffs/core.md: "McpAuth may be a
// documented stub ... if full implementation doesn't fit this round"). DH-0002 wired up a
// real MCP client (src/agent/mcp/) for unauthenticated servers, but OAuth-authenticated MCP
// servers are split out to DH-0057, still out of scope here — no OAuth flow to drive yet.
// This tool is
// wired into the tool set with a real, testable, always-clear-error response rather than
// being silently omitted, so the model gets an actionable message instead of an unknown-tool
// failure. Full implementation (device/browser OAuth flow, token storage) is future work.

import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

export const mcpAuthTool: Tool = Object.freeze<Tool>({
  name: "McpAuth",
  description:
    "Handle MCP OAuth flows for a configured MCP server. NOT IMPLEMENTED this round (stub).",
  inputSchema: {
    type: "object",
    properties: {
      server: { type: "string", description: "The mcpServers config key to authenticate." },
    },
    required: ["server"],
    additionalProperties: false,
  },

  async execute(input, _ctx: ToolContext): Promise<ToolResult> {
    const server = input.server;
    if (typeof server !== "string" || server.length === 0) {
      return { output: "McpAuth tool error: 'server' must be a non-empty string.", isError: true };
    }
    return {
      output: `McpAuth is not implemented in this round. MCP server "${server}" cannot be authenticated; servers requiring OAuth are unsupported until an MCP client lands. See docs/handoffs/core.md status log.`,
      isError: true,
    };
  },
});
