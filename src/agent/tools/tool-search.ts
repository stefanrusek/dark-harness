// ToolSearch tool — discovers deferred (MCP) tools by keyword query (HANDOFF.md §4).
// See src/agent/mcp.ts for the scope note: this searches configured mcpServers entries,
// it does not dial a live MCP server in this round.

import type { Tool, ToolContext, ToolResult } from "./types.ts";

export const toolSearchTool: Tool = {
  name: "ToolSearch",
  description: "Search for deferred tools (e.g. from configured MCP servers) by keyword.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const query = input.query;
    if (typeof query !== "string") {
      return { output: "ToolSearch tool error: 'query' must be a string.", isError: true };
    }

    const results = ctx.searchDeferredTools(query);
    if (results.length === 0) {
      return { output: `No deferred tools matched "${query}".`, isError: false };
    }
    return { output: results.map((r) => `${r.name}: ${r.description}`).join("\n"), isError: false };
  },
};
