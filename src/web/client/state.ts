// Pure state management for the web UI. No DOM, no network — a reducer over
// `ServerSentEvent`s (src/contracts/events.ts) plus a few UI-only fields (selection,
// connection status). Kept framework-free and fully unit-testable.

import type { AgentStatus, ServerSentEvent } from "../../contracts/index.ts";

export interface AgentNode {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  status: AgentStatus;
  /** Accumulated output chunks, concatenated in arrival order. */
  output: string;
  /**
   * Cumulative token/cost totals for this agent. `TokenUsageEvent`s are treated as
   * incremental deltas (matching how per-call usage is reported by LLM APIs) and summed
   * here.
   *
   * ASSUMPTION flagged in docs/handoffs/web.md status log: the contracts module doesn't
   * state whether `TokenUsageEvent` fields are deltas or running totals. If Server intends
   * running totals instead, this reducer needs a one-line change (replace instead of add).
   */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  spawnOrder: number;
}

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface WebState {
  /** Insertion-ordered by first-seen; Map preserves insertion order in JS. */
  agents: Map<string, AgentNode>;
  rootAgentId: string | null;
  selectedAgentId: string | null;
  connectionStatus: ConnectionStatus;
  sessionEnded: boolean;
  exitCode: number | null;
  /** Highest SSE event id observed, for diagnostics / potential manual resume. */
  lastEventId: string | null;
}

let spawnCounter = 0;

export function createInitialState(): WebState {
  spawnCounter = 0;
  return {
    agents: new Map(),
    rootAgentId: null,
    selectedAgentId: null,
    connectionStatus: "connecting",
    sessionEnded: false,
    exitCode: null,
    lastEventId: null,
  };
}

function ensureAgent(state: WebState, agentId: string): AgentNode {
  const existing = state.agents.get(agentId);
  if (existing) return existing;
  const node: AgentNode = {
    agentId,
    parentAgentId: null,
    model: "",
    status: "waiting",
    output: "",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    spawnOrder: spawnCounter++,
  };
  state.agents.set(agentId, node);
  return node;
}

/** Applies one SSE event to state, returning a new `WebState` (state is not mutated). */
export function applyEvent(state: WebState, event: ServerSentEvent): WebState {
  const next: WebState = {
    ...state,
    agents: new Map(state.agents),
    lastEventId: event.id,
  };

  switch (event.type) {
    case "agent_spawned": {
      const node = { ...ensureAgent(next, event.agentId) };
      node.parentAgentId = event.parentAgentId;
      node.model = event.model;
      next.agents.set(event.agentId, node);
      if (event.parentAgentId === null && next.rootAgentId === null) {
        next.rootAgentId = event.agentId;
      }
      if (next.selectedAgentId === null) {
        next.selectedAgentId = event.agentId;
      }
      return next;
    }
    case "agent_output": {
      const node = { ...ensureAgent(next, event.agentId) };
      node.output += event.chunk;
      next.agents.set(event.agentId, node);
      return next;
    }
    case "agent_status": {
      const node = { ...ensureAgent(next, event.agentId) };
      node.status = event.status;
      next.agents.set(event.agentId, node);
      return next;
    }
    case "token_usage": {
      const node = { ...ensureAgent(next, event.agentId) };
      node.inputTokens += event.inputTokens;
      node.outputTokens += event.outputTokens;
      node.costUsd += event.costUsd ?? 0;
      next.agents.set(event.agentId, node);
      return next;
    }
    case "session_ended": {
      next.sessionEnded = true;
      next.exitCode = event.exitCode;
      return next;
    }
    default: {
      // Exhaustiveness check: fails to compile if a new ServerSentEvent variant is added
      // to src/contracts/ without a case here. At runtime this is reachable if a future
      // server build sends an event type this client build predates — tolerate it rather
      // than corrupt state: keep `next` (already has the bumped `lastEventId`), don't
      // return the raw unrecognized event itself.
      const _exhaustive: never = event;
      void _exhaustive;
      return next;
    }
  }
}

export function setConnectionStatus(state: WebState, status: ConnectionStatus): WebState {
  return { ...state, connectionStatus: status };
}

export function selectAgent(state: WebState, agentId: string): WebState {
  if (!state.agents.has(agentId)) return state;
  return { ...state, selectedAgentId: agentId };
}

export function selectedAgent(state: WebState): AgentNode | null {
  if (!state.selectedAgentId) return null;
  return state.agents.get(state.selectedAgentId) ?? null;
}

export function isRoot(state: WebState, agentId: string): boolean {
  return state.rootAgentId === agentId;
}

/** Agents sorted by spawn order (stable, deterministic tree-list ordering). */
export function orderedAgents(state: WebState): AgentNode[] {
  return [...state.agents.values()].sort((a, b) => a.spawnOrder - b.spawnOrder);
}

export interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function sessionTotals(state: WebState): SessionTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const agent of state.agents.values()) {
    inputTokens += agent.inputTokens;
    outputTokens += agent.outputTokens;
    costUsd += agent.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}
