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

export type ServerSentEvent =
  | AgentOutputEvent
  | AgentStatusEvent
  | AgentSpawnedEvent
  | TokenUsageEvent
  | SessionEndedEvent
  | ResyncEvent;
