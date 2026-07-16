// Internal tool interface — not part of src/contracts/ (that's wire truth for client<->server;
// this is the in-process shape between the agent loop and its tool implementations). Each
// tool mirrors the semantics of the Claude-Code tool of the same name (HANDOFF.md §4).

import type { DhConfig } from "../../contracts/index.ts";
import type { ProviderCompletionRequest, ProviderCompletionResult } from "../providers/types.ts";
import type { TaskRegistry } from "../tasks.ts";
import type { TodoStore } from "../todos.ts";

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
  /** Starts a sub-agent as a task; resolves to the task id immediately (task runs concurrently).
   * `background` (Round 12, default true) should mirror the tool call's own
   * `run_in_background` resolution — only a background spawn gets a completion
   * push-notification into the parent's conversation when it finishes; see
   * docs/handoffs/core.md's Round 12 entry and TaskRegistry's `onSettled` doc comment. */
  spawnAgent(params: {
    model: string;
    prompt: string;
    background?: boolean;
    /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label from the Agent
     * tool's optional `description` param, threaded through to TaskSnapshot/Monitor/the
     * agent tree/the JSONL log header. */
    description?: string;
    /** DH-0077: when "worktree", the spawned sub-agent's cwd is a freshly created git
     * worktree (see runtime.ts's spawnAgent()/worktree.ts) instead of inheriting the
     * spawning agent's own cwd. */
    isolation?: "worktree";
  }): string;
  /** Skill lookup: scans config.skillPaths for `<name>/SKILL.md`. */
  loadSkill(name: string): Promise<{ name: string; path: string; content: string } | null>;
  /** Deferred-tool discovery (DH-0002): searches the merged corpus of every built-in tool
   * (always "active") plus every MCP-discovered tool across configured mcpServers, per the
   * real ToolSearch query grammar implemented in tools/tool-search.ts (`select:Name1,Name2`
   * exact selection + activation, `+term` required-token filtering, keyword ranking,
   * `max_results`). Async because a `select:` or corpus-touching query may trigger a
   * throttled reconnect attempt against a previously-failed MCP server (McpManager).
   * `results` carries full descriptors (including inputSchema) so the model can call a
   * newly-activated tool on its very next turn; `notFound` lists `select:` names that
   * matched nothing; `unreachableServers` surfaces currently-failed MCP servers with their
   * last error so ToolSearch's footer never silently drops that information. */
  searchDeferredTools(
    query: string,
    options?: { maxResults?: number },
  ): Promise<{
    results: Array<{
      name: string;
      description: string;
      inputSchema: JsonSchema;
      deferred?: boolean;
      serverName?: string;
    }>;
    notFound?: string[];
    unreachableServers?: Array<{ name: string; error: string }>;
  }>;
  /** Round 13 (docs/handoffs/core.md): per-agent read registry backing read-before-Edit/Write
   * enforcement — mirrors real Claude Code's refusal to blind-edit a file the model never
   * `Read` in this conversation, or that changed on disk since the read. Keyed by resolved
   * absolute path; populated by the Read tool, checked by Edit (always) and Write (only when
   * overwriting an existing path — a brand-new file needs no prior read). One instance per
   * ToolContext, and ToolContext is one-per-agent-lifetime (see runtime.ts's
   * buildToolContext), so this is naturally scoped to "this agent's own conversation," not
   * shared across sibling sub-agents editing the same filesystem. */
  readRegistry: Map<string, { mtimeMs: number; size: number }>;
  /** DH-0002: per-agent set of MCP tool names (`mcp__<server>__<tool>`) this agent's
   * ToolSearch calls have activated via `select:` — same per-ToolContext scoping precedent
   * as `readRegistry`, fresh per agent lifetime (see runtime.ts's buildToolContext). Built-in
   * tools never need activation (they never set `deferred`); loop.ts's per-turn `toolDefs`
   * filter hides any `deferred` tool whose name isn't in this set from the provider. */
  activatedTools: Set<string>;
  /** DH-0076: this agent's own self-authored todo/plan store, backing the TodoCreate/
   * TodoGet/TodoList/TodoUpdate tool family. Deliberately separate from `tasks` (TaskRegistry
   * supervises real concurrent jobs; TodoStore is a dumb ordered map of planning records with
   * zero execution semantics) — same per-ToolContext, per-agent-lifetime scoping precedent as
   * `readRegistry`/`activatedTools` above. */
  todos: TodoStore;
  /** DH-0074: makes one non-streaming completion call against a `ModelConfig.name` (looked
   * up the same way `spawnAgent`'s `model` param is), for tools that need a small model
   * inference step of their own rather than spawning a whole sub-agent (WebFetch's
   * `extractionModel`). Its usage is fed into the same session-wide cumulative cost/token
   * budgets (DH-0013) and SSE/log `token_usage` reporting every agent turn gets — see
   * runtime.ts's `buildToolContext`. Throws `ConfigModelError` (runtime.ts) if the model name
   * doesn't resolve. */
  completeWithModel(
    modelName: string,
    request: Omit<ProviderCompletionRequest, "model">,
  ): Promise<ProviderCompletionResult>;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** DH-0002: true for every MCP-discovered tool (never set by built-ins). A `deferred`
   * tool is hidden from the model provider's tool list (loop.ts's per-turn `toolDefs`
   * filter) until ToolSearch's `select:` activates it for this agent (`ToolContext.
   * activatedTools`) — mirrors real Claude Code's deferred-tool model and keeps large MCP
   * servers from bloating every turn's context window. Dispatch itself never special-cases
   * this field: `params.tools.get(name)` finds a deferred tool exactly like a built-in once
   * it's in the map. */
  deferred?: boolean;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
