// Adapter (DH-0002): folds each `McpManager`-discovered tool into this project's own `Tool`
// interface (src/agent/tools/types.ts) so `loop.ts`'s dispatch (`params.tools.get(name)` ->
// `tool.execute()`) never needs to special-case MCP tools at all.

import type { JsonSchema, Tool, ToolContext, ToolResult } from "../tools/types.ts";
import type { McpToolDescriptor } from "./manager.ts";
import type { McpManager } from "./manager.ts";

/** The naming convention the original stub already established (and the same shape real
 * Claude Code uses for MCP-derived tools). */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

function adaptInputSchema(schema: McpToolDescriptor["inputSchema"]): JsonSchema {
  return {
    type: "object",
    properties: (schema.properties as Record<string, unknown>) ?? {},
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.additionalProperties !== undefined
      ? { additionalProperties: schema.additionalProperties }
      : {}),
  };
}

/** Maps an MCP `callTool` result into this project's `ToolResult`: text content blocks are
 * concatenated; non-text blocks are JSON-encoded with a `[type: X]` note; MCP's own
 * `isError` becomes `ToolResult.isError`. */
function adaptCallResult(result: {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}): ToolResult {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else {
      parts.push(`[type: ${block.type}] ${JSON.stringify(block)}`);
    }
  }
  return {
    output: parts.join("\n") || "(MCP tool returned no content)",
    isError: result.isError ?? false,
  };
}

/** Builds one `Tool` per discovered MCP tool. Every MCP-derived tool sets `deferred: true`
 * (loop.ts's per-turn filter keeps it invisible to the provider until ToolSearch's
 * `select:` activates it — see tool-search.ts and types.ts's `activatedTools`). */
export function buildMcpTool(manager: McpManager, descriptor: McpToolDescriptor): Tool {
  const name = mcpToolName(descriptor.serverName, descriptor.name);
  return {
    name,
    description:
      descriptor.description ||
      `(MCP tool "${descriptor.name}" from server "${descriptor.serverName}")`,
    inputSchema: adaptInputSchema(descriptor.inputSchema),
    deferred: true,
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      try {
        const result = await manager.callTool(descriptor.serverName, descriptor.name, input);
        return adaptCallResult(result);
      } catch (err) {
        return {
          output: `MCP tool "${descriptor.name}" on server "${descriptor.serverName}" failed: ${(err as Error).message}`,
          isError: true,
        };
      }
    },
  };
}

/** Builds the full set of MCP-derived `Tool`s currently discoverable from `manager`. Called
 * once per successful (re)connect/discovery cycle by the runtime, which merges the result
 * into its shared `toolMap`. */
export function buildMcpTools(manager: McpManager): Tool[] {
  const { tools } = manager.listAllTools();
  return tools.map((descriptor) => buildMcpTool(manager, descriptor));
}
