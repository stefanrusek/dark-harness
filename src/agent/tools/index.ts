// The fixed tool set (HANDOFF.md §4). Every root and sub-agent gets exactly this set.

import { agentTool } from "./agent.ts";
import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { mcpAuthTool } from "./mcp-auth.ts";
import { monitorTool } from "./monitor.ts";
import { notebookEditTool } from "./notebook-edit.ts";
import { readTool } from "./read.ts";
import { sendMessageTool } from "./send-message.ts";
import { skillTool } from "./skill.ts";
import { taskOutputTool } from "./task-output.ts";
import { taskStopTool } from "./task-stop.ts";
import { todoCreateTool } from "./todo-create.ts";
import { todoGetTool } from "./todo-get.ts";
import { todoListTool } from "./todo-list.ts";
import { todoUpdateTool } from "./todo-update.ts";
import { toolSearchTool } from "./tool-search.ts";
import type { Tool } from "./types.ts";
import { writeTool } from "./write.ts";

// DH-0054 (tracking/DH-0054-no-first-class-grep-glob-tools.md): Grep/Glob join the fixed
// tool set alongside Bash — search is no longer entirely informal ("shell out to grep/find
// via Bash"); Bash's own `grep`/`find` remain available too (the cli-tools skill's "generic
// POSIX tools" framing), this just gives a structured, cross-platform alternative.
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
  grepTool,
  globTool,
  notebookEditTool,
  todoCreateTool,
  todoGetTool,
  todoListTool,
  todoUpdateTool,
];

export function buildToolMap(tools: Tool[] = ALL_TOOLS): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export * from "./agent.ts";
export * from "./bash.ts";
export * from "./edit.ts";
export * from "./glob.ts";
export * from "./grep.ts";
export * from "./mcp-auth.ts";
export * from "./monitor.ts";
export * from "./notebook-edit.ts";
export * from "./read.ts";
export * from "./send-message.ts";
export * from "./skill.ts";
export * from "./task-output.ts";
export * from "./task-stop.ts";
export * from "./todo-create.ts";
export * from "./todo-get.ts";
export * from "./todo-list.ts";
export * from "./todo-update.ts";
export * from "./tool-search.ts";
export * from "./types.ts";
export * from "./write.ts";
