// Pure state management for the web UI. No DOM, no network — a reducer over
// `ServerSentEvent`s (src/contracts/events.ts) plus a few UI-only fields (selection,
// connection status). Kept framework-free and fully unit-testable.

import type {
  AgentStatus,
  AgentTreeNode,
  ModelInfo,
  ServerSentEvent,
  SkillInfo,
} from "../../contracts/index.ts";

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
  // DH-0093: "system" is a local, never-sent transcript entry (`/help` output) — distinct
  // from "user" (an actual sent/echoed message) and "assistant" (streamed model output).
  // DH-0089: "tool" is a synthetic marker for a generic tool call/result (`toolName:
  // inputSummary`, e.g. `Bash: bun test`) — the same role the TUI calls `"tool"`.
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  /** ISO timestamp of the turn's first chunk (assistant) or the moment it was sent (user). */
  timestamp: string;
  /** DH-0089: set on a `"tool"` turn once its matching `tool_result` reports `isError: true`.
   * Meaningless on every other role. */
  toolError?: boolean;
  /** DH-0130: set on a `"tool"` marker turn synthesized when an agent reaches a terminal
   * status (done/failed/stopped), so the render layer can style it via DH-0137's status
   * tokens instead of the generic dim tool-marker styling. Mirrors src/tui/state.ts's
   * identical field. */
  terminalStatus?: AgentStatus;
}

export interface AgentNode {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  status: AgentStatus;
  /** DH-0069: human-readable label from the spawning `Agent` tool call's (now-required)
   * `description` parameter — the sidebar/tree row's primary label, falling back to
   * `model (shortAgentId)` only when absent (the root agent, which was never spawned via the
   * Agent tool, or a pre-DH-0069 logged session). See `AgentSpawnedEvent.description`
   * (src/contracts/events.ts). */
  description?: string;
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
  /** DH-0104: whether any `token_usage` event for this agent has ever carried a `costUsd`
   * (i.e. the model has pricing configured). Distinguishes "known cost of exactly $0.00"
   * from "cost unknown" (unpriced model) — without this, both looked identical (`costUsd`
   * defaulting to 0) and the unknown case rendered as `$0.00`, misrepresenting an unpriced
   * model as free (the ticket's one "real correctness angle" per its Risks section). Purely
   * a display-layer flag — doesn't change how `costUsd` itself is summed. */
  hasCost: boolean;
  spawnOrder: number;
  /**
   * DH-0066: whether the transcript's last turn is still an "open" assistant turn that a
   * fresh `agent_output` chunk should extend. Without this, two genuinely separate
   * assistant turns (e.g. a turn that finished, then a later turn after the agent went
   * `running` again) both being `role: "assistant"` back-to-back meant a new chunk always
   * got merged into the previous turn's text with no boundary at all — the architect
   * review's "two turns concatenate into one bubble" finding. Cleared whenever the agent's
   * status leaves `"running"` (the turn is over); set whenever a chunk is appended.
   */
  turnOpen: boolean;
  /** DH-0089: transcript index of the marker turn created by the most recent unresolved
   * `tool_call` for this agent, keyed by its `toolUseId` — lets the matching `tool_result`
   * update that same turn (error suffix/class) instead of opening a new one. `null` when no
   * tool call is outstanding, or the outstanding one was suppressed (`toolName === "Agent"`
   * — see `applyEvent`'s `tool_call` case). Cleared once the matching `tool_result` arrives. */
  pendingToolCall: { toolUseId: string; turnIndex: number } | null;
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

// DH-0105: canonical four-state connection vocabulary shared with the TUI
// (docs/design/style-guide.md §1/§6) — "live" (was "open") and "disconnected" (was
// "closed") are the renamed states; "connecting" and "reconnecting" already matched the
// shared vocabulary.
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "disconnected";

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
  /** DH-0093: cached `list_skills` result, fetched once at startup (app.ts, alongside the
   * existing `request_agent_tree` bootstrap) so `/help` and `/<skillname>` resolve locally
   * with no per-keystroke round-trip. Empty until the first response arrives. */
  skills: SkillInfo[];
  /** DH-0093: cached `list_models` result — populated by a `/model` (no-arg) response and
   * shown in the picker modal (`modelPickerOpen`). */
  models: ModelInfo[];
  /** DH-0093: whether the `/model` picker modal is currently shown. */
  modelPickerOpen: boolean;
}

export interface ErrorLogEntry {
  message: string;
  timestamp: string;
}

const MAX_ERROR_LOG_ENTRIES = 50;

/** DH-0012: bound per-agent transcript buffer (total chars across all turns) so a very long
 * session's DOM/state doesn't grow memory unboundedly, matching the TUI's `MAX_OUTPUT_CHARS`
 * cap (`src/tui/state.ts`) conceptually — oldest turns are dropped first (and, if needed, the
 * oldest remaining turn's text is trimmed from its start), newest content is always kept in
 * full. Web has no reason to diverge from TUI's number. */
const MAX_TRANSCRIPT_CHARS = 200_000;

/** DH-0012: cap `agents` at this many *terminal* (done/failed/stopped) entries, oldest evicted
 * first — active (non-terminal) agents are never evicted regardless of count. Matches the
 * owner's fixed-count-cap decision applied consistently across Core/Server/TUI/Web (see
 * tracking/DH-0012 and `src/tui/state.ts`'s `DEFAULT_COMPLETED_RETENTION`); the Web client has
 * no `dh.json` access (it's browser-only), so this is its own default until/unless a config
 * value is threaded through some other way. */
export const DEFAULT_COMPLETED_RETENTION = 50;

const TERMINAL_STATUSES = new Set<AgentStatus>(["done", "failed", "stopped"]);

/** Evict the oldest terminal (done/failed/stopped) agents from `state.agents` beyond
 * `retention` most-recent terminal entries, in first-seen (`spawnOrder`) order. Active agents
 * are never evicted, so `retention` bounds only "how much completed history sticks around,"
 * never "how many agents can be in flight." */
function evictCompletedAgents(state: WebState, retention: number): WebState {
  const terminal = [...state.agents.values()]
    .filter((agent) => TERMINAL_STATUSES.has(agent.status))
    .sort((a, b) => a.spawnOrder - b.spawnOrder);
  if (terminal.length <= retention) return state;
  const toEvict = terminal.slice(0, terminal.length - retention);
  const agents = new Map(state.agents);
  for (const agent of toEvict) agents.delete(agent.agentId);
  return { ...state, agents };
}

/** Drop oldest turns (and, if needed, trim the oldest remaining turn's text from its start)
 * until the total character count across `transcript` is at or under `max`. Mirrors the TUI's
 * `trimTranscript` (`src/tui/state.ts`); Web transcripts are always plain JS strings (no
 * terminal-width/codepoint-slicing concerns), so a plain string `slice` is sufficient here. */
function trimTranscript(transcript: Turn[], max: number): Turn[] {
  let total = transcript.reduce((sum, turn) => sum + turn.text.length, 0);
  if (total <= max) return transcript;
  const out = [...transcript];
  while (out.length > 0 && total > max) {
    const oldest = out[0];
    if (!oldest) break;
    const excess = total - max;
    if (oldest.text.length <= excess) {
      total -= oldest.text.length;
      out.shift();
    } else {
      out[0] = { ...oldest, text: oldest.text.slice(excess) };
      total -= excess;
    }
  }
  return out;
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
    possibleGap: false,
    errorLog: [],
    skills: [],
    models: [],
    modelPickerOpen: false,
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
    hasCost: false,
    spawnOrder: spawnCounter++,
    turnOpen: false,
    pendingToolCall: null,
    statusSince: timestamp,
  };
  state.agents.set(agentId, node);
  return node;
}

/**
 * Appends a streamed chunk to a transcript: extends the last turn in place only when it's
 * both already an assistant turn *and* that turn is still open (`turnOpen` — see
 * `AgentNode.turnOpen`'s doc comment for why "last turn is an assistant turn" alone isn't a
 * safe merge condition), or opens a new assistant turn otherwise (transcript empty, the last
 * turn was the operator's own message, or the previous assistant turn already closed).
 * Returns a new array; never mutates `transcript`.
 */
function appendAssistantChunk(
  transcript: Turn[],
  chunk: string,
  timestamp: string,
  turnOpen: boolean,
): Turn[] {
  const last = transcript.at(-1);
  const next =
    last && last.role === "assistant" && turnOpen
      ? [...transcript.slice(0, -1), { ...last, text: last.text + chunk }]
      : [...transcript, { role: "assistant" as const, text: chunk, timestamp }];
  return trimTranscript(next, MAX_TRANSCRIPT_CHARS);
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
  node.transcript = trimTranscript(
    [...node.transcript, { role: "user", text, timestamp }],
    MAX_TRANSCRIPT_CHARS,
  );
  // A user turn always ends whatever assistant turn preceded it (there isn't one open here
  // anyway, since sends only happen between turns), and guarantees the *next* agent_output
  // chunk opens a fresh assistant turn rather than merging into stale prior text.
  node.turnOpen = false;
  next.agents.set(agentId, node);
  return next;
}

/**
 * DH-0093: adds a local, never-sent `/help` transcript entry (mirrors `addUserTurn`'s
 * shape/lifecycle — always opens a fresh entry, ends any open assistant turn — but tagged
 * `role: "system"` so the render layer can style it distinctly and never mistakes it for a
 * real sent message).
 */
export function addSystemTurn(
  state: WebState,
  agentId: string,
  text: string,
  timestamp: string = new Date().toISOString(),
): WebState {
  const next: WebState = { ...state, agents: new Map(state.agents) };
  const node = { ...ensureAgent(next, agentId, timestamp) };
  node.transcript = trimTranscript(
    [...node.transcript, { role: "system", text, timestamp }],
    MAX_TRANSCRIPT_CHARS,
  );
  node.turnOpen = false;
  next.agents.set(agentId, node);
  return next;
}

/** DH-0093 `/clear`: clears every tracked agent's transcript view only — no wire command,
 * and the agent's own in-memory context is deliberately unaffected in v1 (see the `/help`
 * text this state feeds, which discloses this explicitly). */
export function clearAllTranscripts(state: WebState): WebState {
  const agents = new Map(state.agents);
  for (const [id, agent] of agents) agents.set(id, { ...agent, transcript: [], turnOpen: false });
  return { ...state, agents };
}

export function setSkills(state: WebState, skills: SkillInfo[]): WebState {
  return { ...state, skills };
}

/** DH-0093: `/model` (no-arg) response — caches the list and opens the picker modal. */
export function setModelsAndOpenPicker(state: WebState, models: ModelInfo[]): WebState {
  return { ...state, models, modelPickerOpen: true };
}

export function closeModelPicker(state: WebState): WebState {
  return { ...state, modelPickerOpen: false };
}

/** DH-0089: appends a synthetic `"tool"` marker turn — always a fresh turn, never merged
 * with a neighboring turn (same lifecycle as `addUserTurn`/`addSystemTurn`). */
function appendToolTurn(
  state: WebState,
  agentId: string,
  text: string,
  timestamp: string,
): WebState {
  const node = { ...ensureAgent(state, agentId, timestamp) };
  node.transcript = trimTranscript(
    [...node.transcript, { role: "tool" as const, text, timestamp }],
    MAX_TRANSCRIPT_CHARS,
  );
  node.turnOpen = false;
  state.agents.set(agentId, node);
  return state;
}

/** DH-0089 `tool_call` handler: appends the generic "toolName: inputSummary" marker and
 * records the new turn's index as `pendingToolCall`. Per D5, `toolName === "Agent"` is
 * suppressed entirely — DH-0065-equivalent spawn info is already shown via `agent_spawned`
 * (`description`/`model` on the sidebar), and rendering both would double-mark every spawn;
 * a failed spawn is still surfaced because its `tool_result` (no matching pending entry)
 * falls through to the standalone-error-marker branch in `handleToolResult`. */
function handleToolCall(
  state: WebState,
  event: Extract<ServerSentEvent, { type: "tool_call" }>,
): WebState {
  if (event.toolName === "Agent") return state;
  const next = appendToolTurn(
    state,
    event.agentId,
    `${event.toolName}: ${event.inputSummary}`,
    event.timestamp,
  );
  const existing = next.agents.get(event.agentId);
  if (!existing) return next;
  const node: AgentNode = {
    ...existing,
    pendingToolCall: { toolUseId: event.toolUseId, turnIndex: existing.transcript.length - 1 },
  };
  next.agents.set(event.agentId, node);
  return next;
}

/** DH-0089 `tool_result` handler. If this resolves an outstanding `pendingToolCall` (the
 * common case), marks that same marker turn `toolError` when `isError` (a no-op on success —
 * leave the marker unchanged) and clears the pending entry. Otherwise (resume gap, or a
 * suppressed `Agent` `tool_call`) renders a standalone `"toolName ✗"` marker when `isError`,
 * and drops the event on success — nothing to show for an already-invisible call. */
function handleToolResult(
  state: WebState,
  event: Extract<ServerSentEvent, { type: "tool_result" }>,
): WebState {
  const agent = state.agents.get(event.agentId);
  const pending = agent?.pendingToolCall;
  if (agent && pending && pending.toolUseId === event.toolUseId) {
    const node = { ...agent };
    const turn = node.transcript[pending.turnIndex];
    node.transcript = turn
      ? node.transcript.map((t, i) =>
          i === pending.turnIndex && event.isError ? { ...t, toolError: true } : t,
        )
      : node.transcript;
    node.pendingToolCall = null;
    state.agents.set(event.agentId, node);
    return state;
  }
  if (!event.isError) return state;
  return appendToolTurn(state, event.agentId, `${event.toolName} ✗`, event.timestamp);
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
      if (event.description !== undefined) node.description = event.description;
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
      node.transcript = appendAssistantChunk(
        node.transcript,
        event.chunk,
        event.timestamp,
        node.turnOpen,
      );
      node.turnOpen = true;
      next.agents.set(event.agentId, node);
      return next;
    }
    case "agent_status": {
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
      const priorStatus = node.status;
      if (node.status !== event.status) {
        node.statusSince = event.timestamp;
      }
      node.status = event.status;
      // DH-0066: leaving "running" closes whatever assistant turn was accumulating, so the
      // next agent_output chunk (a new turn, whenever the agent goes running again) opens a
      // fresh turn instead of silently concatenating onto the previous one.
      if (event.status !== "running") node.turnOpen = false;
      // DH-0130: a newly-reached terminal status gets an in-transcript marker turn, mirroring
      // src/tui/state.ts's appendTerminalMarker -- previously only the sidebar/tree reflected
      // a terminal status, with nothing visible in the agent's own transcript.
      if (TERMINAL_STATUSES.has(event.status) && priorStatus !== event.status) {
        node.transcript = [
          ...node.transcript,
          {
            role: "tool",
            text: `Agent ${event.status}`,
            timestamp: event.timestamp,
            terminalStatus: event.status,
          },
        ];
      }
      next.agents.set(event.agentId, node);
      // DH-0012: only a status change can newly make an agent terminal, so eviction only
      // needs to run here (matching the TUI's placement in `src/tui/state.ts`).
      return evictCompletedAgents(next, DEFAULT_COMPLETED_RETENTION);
    }
    case "token_usage": {
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
      node.inputTokens += event.inputTokens;
      node.outputTokens += event.outputTokens;
      if (event.costUsd !== undefined) {
        node.costUsd += event.costUsd;
        node.hasCost = true;
      }
      next.agents.set(event.agentId, node);
      return next;
    }
    case "session_ended": {
      next.sessionEnded = true;
      next.exitCode = event.exitCode;
      return next;
    }
    case "resync":
      next.possibleGap = true;
      return next;
    case "tool_call":
      return handleToolCall(next, event);
    case "tool_result":
      return handleToolResult(next, event);
    // DH-0045: `agent_thinking` is a new additive SSE event type (Core's piece of DH-0045)
    // not yet consumed here — full display (collapsed `<details>` turn, redaction
    // placeholder) is Web's own ticket (see DH-0045 §7/§8). No-op here for the same reason
    // as tool_call/tool_result above: keeps `assertNever` guarding real unhandled variants
    // without blocking Core's typecheck gate.
    case "agent_thinking":
      return next;
    // DH-0093: this round's real consumption of `model_switched` — updates the switched
    // agent's displayed model (the backend round only added the no-op exhaustiveness case
    // above's predecessor comment). No dedicated UI element shows "model" today beyond the
    // agent header/sidebar's `agent.model` field where relevant; updating that field here is
    // what makes a subsequent render actually reflect the switch.
    case "model_switched": {
      const node = { ...ensureAgent(next, event.agentId, event.timestamp) };
      node.model = event.to;
      next.agents.set(event.agentId, node);
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
      ...(node.description !== undefined ? { description: node.description } : {}),
      transcript: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      hasCost: false,
      spawnOrder: spawnCounter++,
      turnOpen: false,
      pendingToolCall: null,
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

/**
 * DH-0066: depth of `agentId` in the spawn tree (root is 0), by walking `parentAgentId`
 * links. The sidebar previously rendered `orderedAgents` as a flat list with no depth
 * information at all — this is what lets the render layer indent rows so parent/child
 * actually reads as a tree. Guards against a cyclic/dangling `parentAgentId` (shouldn't
 * happen, but a render-layer helper should never infinite-loop on bad data) by capping at
 * the number of known agents.
 */
export function agentDepth(state: WebState, agentId: string): number {
  let depth = 0;
  let current = state.agents.get(agentId);
  const limit = state.agents.size;
  while (current?.parentAgentId != null && depth < limit) {
    const parent = state.agents.get(current.parentAgentId);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return depth;
}

export interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
  /** `null` if no tracked agent has ever reported a cost figure (DH-0104's unknown-cost
   * case), matching each agent's own `hasCost` semantics. Otherwise sums whatever cost
   * figures are known — an agent with no cost signal contributes 0 to the sum but doesn't
   * flip an otherwise-known total back to unknown. */
  costUsd: number | null;
}

/**
 * DH-0066: browser-tab title reflecting session state, since the tab was previously always
 * the static, anonymous "Dark Harness" no matter what was happening — an operator with
 * several tabs open (or the tab backgrounded) had no way to tell at a glance whether
 * anything needed attention.
 */
export function documentTitle(state: WebState): string {
  if (state.sessionEnded) {
    const ok = state.exitCode === 0;
    return `${ok ? "✓" : "✗"} session ended — Dark Harness`;
  }
  const anyRunning = [...state.agents.values()].some((agent) => agent.status === "running");
  return anyRunning ? "● running — Dark Harness" : "Dark Harness";
}

export function sessionTotals(state: WebState): SessionTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = null;
  for (const agent of state.agents.values()) {
    inputTokens += agent.inputTokens;
    outputTokens += agent.outputTokens;
    if (agent.hasCost) costUsd = (costUsd ?? 0) + agent.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}
