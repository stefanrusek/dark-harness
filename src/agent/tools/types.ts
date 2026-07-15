// Internal tool interface — not part of src/contracts/ (that's wire truth for client<->server;
// this is the in-process shape between the agent loop and its tool implementations). Each
// tool mirrors the semantics of the Claude-Code tool of the same name (HANDOFF.md §4).

import type { DhConfig } from "../../contracts/index.ts";
import type { TaskRegistry } from "../tasks.ts";

/** JSON Schema subset sufficient to describe tool inputs to a model provider. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  /** Text content returned to the model as the tool_result. */
  output: string;
  isError: boolean;
}

/**
 * Everything a tool needs beyond its own input: filesystem root, config, the shared task
 * registry, and a way to spawn a sub-agent without importing the agent loop directly (that
 * would create tools -> loop -> tools cycle; the runtime composition root injects this).
 */
export interface ToolContext {
  /** Working directory tools resolve relative paths against. */
  cwd: string;
  /** Config-level default for run_in_background when a call omits it. */
  runInBackgroundDefault: boolean;
  /** The agent invoking the tool — becomes parentAgentId for anything it spawns. */
  agentId: string;
  config: DhConfig;
  tasks: TaskRegistry;
  /** Starts a sub-agent as a task; resolves to the task id immediately (task runs concurrently). */
  spawnAgent(params: { model: string; prompt: string }): string;
  /** Skill lookup: scans config.skillPaths for `<name>/SKILL.md`. */
  loadSkill(name: string): Promise<{ name: string; path: string; content: string } | null>;
  /** Deferred-tool discovery over configured mcpServers (see docs/handoffs/core.md status log). */
  searchDeferredTools(query: string): Array<{ name: string; description: string }>;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
