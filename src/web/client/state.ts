// Pure state management for the web UI. No DOM, no network — a reducer over
// `ServerSentEvent`s (src/contracts/events.ts) plus a few UI-only fields (selection,
// connection status). Kept framework-free and fully unit-testable.

import type { AgentStatus, AgentTreeNode, ServerSentEvent } from "../../contracts/index.ts";

/** Compile-time-only exhaustiveness helper — see its call site in `applyEvent` below. */
function assertNever(_value: never): void {}

/**
 * One turn in a conversation transcript (docs/handoffs/web.md Round 4). Replaces the old
 * flat `output: string`, which concatenated every `agent_output` chunk into one
 * undifferentiated blob and never recorded the operator's own sent messages at all — the
 * conversation view rendered as a wall of text with no turn separation, unlike real Claude
 * Code's turn-by-turn transcript.
 *
 * `"user"` turns are added client-side, immediately, at send time (see `addUserTurn` below)
 * — they never arrive over SSE, since the server has no reason to echo back what the
 * operator just typed. `"assistant"` turns accumulate `agent_output` chunks: consecutive
 * chunks with no intervening user turn append to the same turn rather than opening a new one
 * each time, since a single model response can stream in many small pieces.
 */
export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp of the turn's first chunk (assistant) or the moment it was sent (user). */
  timestamp: string;
}

export interface AgentNode {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  status: AgentStatus;
  /** Ordered conversation turns for this agent. See `Turn` above. */
  transcript: Turn[];
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
  /**
   * ISO timestamp of the most recent status transition (or, for a freshly-observed node,
   * the moment it was first seen). Every `ServerSentEvent` already carries a `timestamp`
   * (src/contracts/events.ts), so this is derived client-side with no wire-protocol change.
   *
   * Purpose (docs/handoffs/web.md Round 3): `running` is otherwise a single undifferentiated
   * status with no elapsed-time signal, and since the Anthropic provider adapter calls
   * `messages.create` non-streaming, a slow turn and a hung turn look byte-for-byte
   * identical without this. The render layer turns this into a live "Xs/Xm ago" indicator
   * so an operator watching a long-running agent can tell "still thinking" from "silently
   * stalled."
   */
  statusSince: string;
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
  /**
   * DH-0024: set whenever the SSE connection reconnects after a drop (see
   * `sse.ts`'s `onReconnected`) — resuming via `Last-Event-ID` after any disconnection can
   * miss events the server evicted or a restart in between, and there is no server-side
   * gap signal yet to say for certain either way (DH-0019). Surfaced as a dismissible
   * "reconnected — history may be incomplete" banner; cleared by `dismissPossibleGap`.
   */
  possibleGap: boolean;
  /**
   * DH-0029: a durable log of past errors (command failures, SSE reconnects that timed
   * out, etc.), so an operator who missed a transient banner can still review what
   * happened. Newest last; the render layer shows newest first. Capped at
   * `MAX_ERROR_LOG_ENTRIES` so a long session can't grow this unboundedly.
   */
  errorLog: ErrorLogEntry[];
}

export interface ErrorLogEntry {
  message: string;
  timestamp: string;
}

const MAX_ERROR_LOG_ENTRIES = 50;

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
    possibleGap: false,
    errorLog: [],
  };
}

function ensureAgent(state: WebState, agentId: string, timestamp: string): AgentNode {
  const existing = state.agents.get(agentId);
  if (existing) return existing;
  const node: AgentNode = {
    agentId,
    parentAgentId: null,
    model: "",
    status: "waiting",
    transcript: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    spawnOrder: spawnCounter++,
    statusSince: timestamp,
  };
  state.agents.set(agentId, node);
  return node;
}

/**
 * Appends a streamed chunk to a transcript: extends the last turn in place if it's already
 * an assistant turn (the common case — one model response streams in many small chunks), or
 * opens a new assistant turn otherwise (transcript empty, or the last turn was the
 * operator's own message). Returns a new array; never mutates `transcript`.
 */
function appendAssistantChunk(transcript: Turn[], chunk: string, timestamp: string): Turn[] {
  const last = transcript.at(-1);
  if (last && last.role === "assistant") {
    return [...transcript.slice(0, -1), { ...last, text: last.text + chunk }];
  }
  return [...transcript, { role: "assistant", text: chunk, timestamp }];
}

/**
 * Adds the operator's own sent message to the transcript immediately, client-side — this is
 * the local echo every real chat UI does at send time, never waiting on a server round-trip.
 * Always opens a new user turn (never merged with a prior one, unlike assistant chunks: each
 * send is a distinct, deliberate action, not a stream fragment).
 */
export function addUserTurn(
  state: WebState,
  agentId: string,
  text: string,
  timestamp: string = new Date().toISOString(),
): WebState {
  const next: WebState = { ...state, agents: new Map(state.agents) };
  const node = { ...ensureAgent(next, agentId, timestamp) };
  node.transcript = [...node.transcript, { role: "user", text, timestamp }];
  next.agents.set(agentId, node);
  return next;
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
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
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
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
      node.transcript = appendAssistantChunk(node.transcript, event.chunk, event.timestamp);
      next.agents.set(event.agentId, node);
      return next;
    }
    case "agent_status": {
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
      if (node.status !== event.status) {
        node.statusSince = event.timestamp;
      }
      node.status = event.status;
      next.agents.set(event.agentId, node);
      return next;
    }
    case "token_usage": {
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
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
 *
 * `nowIso` seeds `statusSince` for nodes learned this way (the tree response itself carries
 * no per-node timestamp) — pass the wall-clock time the response was handled at. Defaults to
 * `new Date().toISOString()` so existing callers/tests don't need to change; injectable for
 * deterministic tests.
 */
export function seedFromTree(
  state: WebState,
  tree: AgentTreeNode[],
  nowIso: string = new Date().toISOString(),
): WebState {
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
      transcript: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      spawnOrder: spawnCounter++,
      statusSince: nowIso,
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

/** DH-0024: marks that the current session may have a gap in its event history. */
export function markPossibleGap(state: WebState): WebState {
  return { ...state, possibleGap: true };
}

/** Dismisses the "history may be incomplete" banner once the operator has seen it. */
export function dismissPossibleGap(state: WebState): WebState {
  return { ...state, possibleGap: false };
}

/**
 * DH-0029: appends an entry to the persistent error log, oldest-first, capped at
 * `MAX_ERROR_LOG_ENTRIES` (drops the oldest once full) so a long session's log can't grow
 * unboundedly.
 */
export function logError(
  state: WebState,
  message: string,
  timestamp: string = new Date().toISOString(),
): WebState {
  const entries = [...state.errorLog, { message, timestamp }];
  const errorLog =
    entries.length > MAX_ERROR_LOG_ENTRIES
      ? entries.slice(entries.length - MAX_ERROR_LOG_ENTRIES)
      : entries;
  return { ...state, errorLog };
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
