// Pure state management for the web UI. No DOM, no network — a reducer over
// `ServerSentEvent`s (src/contracts/events.ts) plus a few UI-only fields (selection,
// connection status). Kept framework-free and fully unit-testable.

import type { AgentStatus, AgentTreeNode, ServerSentEvent } from "../../contracts/index.ts";

/** Compile-time-only exhaustiveness helper — see its call site in `applyEvent` below. */
function assertNever(_value: never): void {}

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
    default:
      // Exhaustiveness check: fails to compile if a new ServerSentEvent variant is added to
      // src/contracts/ without a case here (assertNever's parameter type is `never`, which
      // `event` only satisfies once every other case has been handled). At runtime this is
      // reachable if a future server build sends an event type this client build predates —
      // tolerate it rather than corrupt state: keep `next` (already has the bumped
      // `lastEventId`), don't return the raw unrecognized event itself.
      // A function call rather than a local `const` deliberately avoids needing a block
      // around this case (biome's noSwitchDeclarations would otherwise require one just to
      // scope the const) — an unbraced last case is what sidesteps a known Bun coverage-
      // instrumentation quirk where its closing brace shows as an uncovered "line" even
      // when the branch executes (see docs/roster/radia.md).
      assertNever(event);
      return next;
  }
}

function flattenTree(tree: AgentTreeNode[], out: AgentTreeNode[] = []): AgentTreeNode[] {
  for (const node of tree) {
    out.push(node);
    flattenTree(node.children, out);
  }
  return out;
}

/**
 * Seeds state from a `request_agent_tree` response. This is the *only* way a fresh session
 * can learn the root agent's id: `agent_spawned` (the other path that sets
 * `rootAgentId`/`selectedAgentId`, above) only fires once the agent loop actually starts,
 * which only happens once someone sends the first message — which the composer can't do
 * without already knowing the root's id. Server synthesizes a pre-start root node
 * (`status: "waiting"`, `parentAgentId: null`) precisely so `request_agent_tree` can answer
 * this before any message is ever sent (see docs/handoffs/web.md's Round 2 status log).
 *
 * Idempotent and safe to call regardless of arrival order relative to SSE events: never
 * overwrites an already-known agent's fields (an `agent_spawned`/`agent_status` that beat
 * this response to the client is strictly more current than a boot-time snapshot), and
 * never moves `rootAgentId`/`selectedAgentId` once already set.
 */
export function seedFromTree(state: WebState, tree: AgentTreeNode[]): WebState {
  const nodes = flattenTree(tree);
  if (nodes.length === 0) return state;

  const next: WebState = { ...state, agents: new Map(state.agents) };
  for (const node of nodes) {
    if (next.agents.has(node.agentId)) continue; // SSE already told us something more current.
    next.agents.set(node.agentId, {
      agentId: node.agentId,
      parentAgentId: node.parentAgentId,
      model: node.model,
      status: node.status,
      output: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      spawnOrder: spawnCounter++,
    });
  }

  const root = nodes.find((node) => node.parentAgentId === null);
  if (root) {
    if (next.rootAgentId === null) next.rootAgentId = root.agentId;
    if (next.selectedAgentId === null) next.selectedAgentId = root.agentId;
  }
  return next;
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
