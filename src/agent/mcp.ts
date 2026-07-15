// MCP deferred-tool discovery — backs the ToolSearch tool (HANDOFF.md §4).
//
// SCOPE NOTE (see docs/handoffs/core.md status log): this round does not implement a real
// MCP client (stdio/HTTP dial-in, tool listing, invocation). It searches the *configured*
// mcpServers entries in dh.json and returns a synthetic descriptor per server so ToolSearch
// has real, testable behavior against real config — but it never connects to a server or
// lists that server's actual tools. Wiring an MCP client is future work.

import type { McpServerConfig } from "../contracts/index.ts";

export interface DeferredToolDescriptor {
  name: string;
  description: string;
}

export function searchConfiguredMcpTools(
  mcpServers: Record<string, McpServerConfig> | undefined,
  query: string,
): DeferredToolDescriptor[] {
  if (!mcpServers) return [];
  const needle = query.trim().toLowerCase();
  const results: DeferredToolDescriptor[] = [];
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const kind = serverConfig.command ? "stdio" : "http";
    const haystack = `${serverName} ${kind}`.toLowerCase();
    if (needle.length === 0 || haystack.includes(needle)) {
      results.push({
        name: `mcp__${serverName}__*`,
        description: `Deferred tools from MCP server "${serverName}" (${kind}). Not yet connected — full MCP client wiring is future work.`,
      });
    }
  }
  return results;
}
