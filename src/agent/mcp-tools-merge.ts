// DH-0173: extracted from AgentRuntime — the MCP-tool-merge step (DH-0002/DH-0091). Behavior-
// preserving: same "merge every currently-discovered MCP tool into the shared toolMap, in
// place, idempotently" semantics as before, just packaged as a standalone function instead
// of a private method closing over `this.mcpManager`/`this.toolMap`.

import type { McpManager } from "./mcp/manager.ts";
import { buildMcpTools } from "./mcp/tools.ts";
import type { Tool } from "./tools/types.type.ts";

/** DH-0002: merges every currently-discovered MCP tool from `mcpManager` into `toolMap`, in
 * place, so `loop.ts`'s fresh-per-turn `toolDefs` read (params.tools) picks up tools that
 * finish connecting after construction with no further plumbing. Idempotent — re-adding an
 * already-present tool just overwrites it with (functionally identical) fresh state; safe
 * to call after every reconnect attempt. */
export function mergeMcpTools(mcpManager: McpManager, toolMap: Map<string, Tool>): void {
  for (const tool of buildMcpTools(mcpManager)) {
    toolMap.set(tool.name, tool);
  }
}
