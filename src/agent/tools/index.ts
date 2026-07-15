// The fixed tool set (HANDOFF.md §4). Every root and sub-agent gets exactly this set.

import { agentTool } from "./agent.ts";
import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { mcpAuthTool } from "./mcp-auth.ts";
import { monitorTool } from "./monitor.ts";
import { readTool } from "./read.ts";
import { sendMessageTool } from "./send-message.ts";
import { skillTool } from "./skill.ts";
import { taskOutputTool } from "./task-output.ts";
import { taskStopTool } from "./task-stop.ts";
import { toolSearchTool } from "./tool-search.ts";
import type { Tool } from "./types.ts";
import { writeTool } from "./write.ts";

export const ALL_TOOLS: Tool[] = [
  bashTool,
  readTool,
  editTool,
  writeTool,
  agentTool,
  toolSearchTool,
  skillTool,
  taskOutputTool,
  sendMessageTool,
  monitorTool,
  taskStopTool,
  mcpAuthTool,
];

export function buildToolMap(tools: Tool[] = ALL_TOOLS): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export * from "./agent.ts";
export * from "./bash.ts";
export * from "./edit.ts";
export * from "./mcp-auth.ts";
export * from "./monitor.ts";
export * from "./read.ts";
export * from "./send-message.ts";
export * from "./skill.ts";
export * from "./task-output.ts";
export * from "./task-stop.ts";
export * from "./tool-search.ts";
export * from "./types.ts";
export * from "./write.ts";
