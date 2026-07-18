// The fixed tool set (HANDOFF.md §4). Every root and sub-agent gets exactly this set, plus
// whatever composeTools() below adds on top for opt-in config (DH-0074).

import type { DhConfig } from "../../contracts/index.ts";
import { agentTool } from "./agent.ts";
import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { mcpAuthTool } from "./mcp-auth.ts";
import { monitorTool } from "./monitor.ts";
import { notebookEditTool } from "./notebook-edit.ts";
import { readTool } from "./read.ts";
import { reportOutcomeTool } from "./report-outcome.ts";
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
import { webFetchTool } from "./web-fetch.ts";
import { webSearchTool } from "./web-search.ts";
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

/**
 * DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16): builds the actual tool
 * set for a runtime from `dh.json`. Deliberately NOT the MCP deferred-tool mechanism (DH-0002)
 * — a `deferred` tool is hidden per-turn but still discoverable/activatable via ToolSearch,
 * which would violate the "absent entirely when not configured" requirement WebFetch/
 * WebSearch need. Presence of `config.web.fetch` registers WebFetch; presence of
 * `config.web.search` registers WebSearch; each is fully independent of the other. Called
 * once at `AgentRuntime` construction (runtime.ts) — the resulting set is uniform across the
 * root agent and every sub-agent it spawns, same as `ALL_TOOLS` itself.
 */
export function composeTools(config: DhConfig): Tool[] {
  const tools = [...ALL_TOOLS];
  if (config.web?.fetch) tools.push(webFetchTool);
  if (config.web?.search) tools.push(webSearchTool);
  return tools;
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
export * from "./report-outcome.ts";
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
export * from "./web-fetch.ts";
export * from "./web-search.ts";
export * from "./write.ts";
/**
 * DH-0050 (architect design, Fable 2026-07-15): `ReportOutcome` is deliberately NOT part of
 * `ALL_TOOLS`/`composeTools()` above — those are shared uniformly by the root and every
 * sub-agent, interactive or not, and an interactive session (server/TUI/Web) has no
 * exit-code/self-report semantics to report into (a conversational turn ending is just
 * "waiting for the next message," see loop.ts's module doc comment). Exported separately so
 * `runtime.ts`'s `AgentRuntime` constructor can add it to `this.toolMap` only when
 * `!this.interactive` — i.e. only for the standalone `--instructions`/`--job` path.
 */
export { reportOutcomeTool };
