// ADR 0002. Server -> client SSE event schema. Every event carries an explicit `version`
// and an `id` usable as the SSE event id for Last-Event-ID resume.

import type { AgentStatus } from "./log.ts";

export interface SseEventBase {
  version: 1;
  id: string;
  timestamp: string;
}

export interface AgentOutputEvent extends SseEventBase {
  type: "agent_output";
  agentId: string;
  chunk: string;
}

export interface AgentStatusEvent extends SseEventBase {
  type: "agent_status";
  agentId: string;
  status: AgentStatus;
}

export interface AgentSpawnedEvent extends SseEventBase {
  type: "agent_spawned";
  agentId: string;
  parentAgentId: string | null;
  model: string;
  /** DH-0069: human-readable label from the Agent tool's `description` parameter (now
   * required for any spawned sub-agent) — lets the Web client's sidebar/tree row show
   * something better than a raw agentId/UUID, matching AgentTreeNode.description
   * (commands.ts), which the TUI already reads from a separate poll path. Undefined only for
   * the root agent, which has no spawning `Agent` tool call to supply one. */
  description?: string;
}

export interface TokenUsageEvent extends SseEventBase {
  type: "token_usage";
  agentId: string;
  /** Per-turn delta, not a running/cumulative total: one event is emitted per provider
   * completion call, sourced directly from that call's own `usage` field (the Anthropic/
   * Bedrock APIs never report conversation-wide cumulative usage). Clients must accumulate
   * (sum) these across events to get a running per-agent total — see DH-0028, which found
   * the TUI doing the wrong thing (replacing instead of summing) while the Web client already
   * summed correctly. */
  inputTokens: number;
  /** See {@link TokenUsageEvent.inputTokens} — same per-turn-delta semantics. */
  outputTokens: number;
  /** See {@link TokenUsageEvent.inputTokens} — same per-turn-delta semantics, when present. */
  costUsd?: number;
}

/**
 * Emitted immediately before a tool's `execute()` call (see `src/agent/loop.ts`'s
 * `runToolCalls()`). Named to match its JSONL log-line counterpart (`tool_call` in
 * `src/contracts/log.ts`) — precedent: `token_usage` already shares its name across both
 * schemas. DH-0089.
 */
export interface ToolCallEvent extends SseEventBase {
  type: "tool_call";
  agentId: string;
  /** Correlates with the matching `tool_result` event (same id as the JSONL line's
   * toolUseId). */
  toolUseId: string;
  toolName: string;
  /** Display-only, single-line, <= TOOL_INPUT_SUMMARY_MAX_CHARS (200) chars, "…"-suffixed
   * when truncated. NEVER the full arguments — the JSONL log's `tool_call` line carries
   * those (redacted per DH-0020); this field exists solely for a compact live indicator.
   * Produced by `src/agent/tool-summary.ts` (Core) and secret-redacted server-side before it
   * reaches the wire. Not parseable — clients must not attempt to reconstruct arguments. */
  inputSummary: string;
}

/**
 * Emitted immediately after a tool's output/isError are determined (both the normal execute
 * path and the unknown-tool-name error branch). DH-0089. Deliberately no output content —
 * outputs can be huge (whole-file Reads) and are the largest secret surface; a compact
 * indicator only needs success/failure. Full output lives in the JSONL log, already redacted
 * per DH-0020.
 */
export interface ToolResultEvent extends SseEventBase {
  type: "tool_result";
  agentId: string;
  toolUseId: string;
  /** Repeated from the `tool_call` event so clients that missed the call (resume gap) can
   * still render something meaningful without a join. */
  toolName: string;
  isError: boolean;
  /** Wall-clock duration of the execute() call. For run_in_background tools (Bash bg, Agent)
   * this measures the synchronous spawn/dispatch, not background completion. */
  durationMs: number;
}

export interface SessionEndedEvent extends SseEventBase {
  type: "session_ended";
  exitCode: number;
}

/**
 * Emitted once, immediately after a client's SSE resume (`Last-Event-ID`) could not be
 * satisfied precisely — the id was unknown (evicted from `EventBuffer`'s retention window,
 * or never seen because the server restarted). The replay that follows is still
 * best-effort (the current buffered window), but this event lets a client positively
 * detect the gap and surface "history may be incomplete" instead of rendering a
 * clean-looking resume. Never emitted on a fresh connection (no `Last-Event-ID` given) or
 * when the id resolved successfully.
 */
export interface ResyncEvent extends SseEventBase {
  type: "resync";
}

/**
 * DH-0093: emitted when a mid-session model switch (`switch_model` command) actually takes
 * effect on the loop's next turn — see `src/agent/loop.ts`'s `registerModelSwitch` sink.
 * `from`/`to` are the friendly `ModelConfig.name` aliases, matching `agent_spawned`'s own
 * `model` field convention.
 */
export interface ModelSwitchedEvent extends SseEventBase {
  type: "model_switched";
  agentId: string;
  from: string;
  to: string;
}

export type ServerSentEvent =
  | AgentOutputEvent
  | AgentStatusEvent
  | AgentSpawnedEvent
  | TokenUsageEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionEndedEvent
  | ResyncEvent
  | ModelSwitchedEvent;
