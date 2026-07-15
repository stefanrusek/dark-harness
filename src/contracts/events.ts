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
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface SessionEndedEvent extends SseEventBase {
  type: "session_ended";
  exitCode: number;
}

export type ServerSentEvent =
  | AgentOutputEvent
  | AgentStatusEvent
  | AgentSpawnedEvent
  | TokenUsageEvent
  | SessionEndedEvent;
