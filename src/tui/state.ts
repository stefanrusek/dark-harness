// Pure application state + reducer: (state, action) -> { state, effects }. No I/O happens
// here — side effects (HTTP commands, process exit) are described as data and executed by
// app.ts. This is what makes the TUI's core logic fully unit-testable without a terminal.

import type { ServerSentEvent } from "../contracts/index.ts";
import type { KeyEvent } from "./keys.ts";
import { flattenTree } from "./tree.ts";
import type { Action, AgentInfo, ReducerResult, TuiState, Turn } from "./types.ts";

/** Bound per-agent transcript buffer (total chars across all turns) so a very long session
 * doesn't grow memory unboundedly. Documented, intentional cap — not a silent truncation of
 * what the user can see live: oldest turns are dropped first, newest content is always kept
 * in full. */
export const MAX_OUTPUT_CHARS = 200_000;

/** Drop oldest turns (and, if needed, trim the oldest remaining turn's text) until the total
 * character count across `transcript` is at or under `max`. */
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

export function initialState(size: { rows: number; cols: number }): TuiState {
  return {
    view: { kind: "root" },
    agents: new Map(),
    agentOrder: [],
    rootAgentId: null,
    tree: null,
    input: "",
    inputCursor: 0,
    connection: "connecting",
    sessionEnded: null,
    size,
    statusMessage: null,
    reconnectNotice: null,
    now: Date.now(),
  };
}

/** Parse an SSE event's ISO `timestamp` into epoch ms, falling back to "now" if the string
 * is ever malformed — a bad timestamp should degrade the liveness indicator, not crash the
 * reducer. */
function parseEventTime(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function defaultAgent(agentId: string, at: number): AgentInfo {
  return {
    agentId,
    parentAgentId: null,
    model: "",
    status: "waiting",
    transcript: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    lastEventAt: at,
    statusSince: at,
  };
}

/** Every event touching an agent bumps `lastEventAt`; only an explicit `status` change also
 * bumps `statusSince`. */
function withAgent(
  state: TuiState,
  agentId: string,
  at: number,
  patch: Partial<AgentInfo>,
): TuiState {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId);
  const agentOrder = existing ? state.agentOrder : [...state.agentOrder, agentId];
  const base = existing ?? defaultAgent(agentId, at);
  const statusChanged = patch.status !== undefined && patch.status !== base.status;
  const next: AgentInfo = {
    ...base,
    ...patch,
    lastEventAt: at,
    statusSince: statusChanged ? at : base.statusSince,
  };
  agents.set(agentId, next);
  return { ...state, agents, agentOrder };
}

/** Appends a streamed `agent_output` chunk as an assistant turn. Consecutive chunks with no
 * intervening user turn extend the existing trailing assistant turn's text rather than
 * starting a new one — a single streamed response should read as one turn, not one per SSE
 * chunk (Round 6, docs/handoffs/tui.md). */
function appendOutput(state: TuiState, agentId: string, at: number, chunk: string): TuiState {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId) ?? defaultAgent(agentId, at);
  const agentOrder = agents.has(agentId) ? state.agentOrder : [...state.agentOrder, agentId];
  const trailing = existing.transcript[existing.transcript.length - 1];
  const transcript =
    trailing?.role === "assistant"
      ? [
          ...existing.transcript.slice(0, -1),
          { role: "assistant" as const, text: trailing.text + chunk },
        ]
      : [...existing.transcript, { role: "assistant" as const, text: chunk }];
  agents.set(agentId, {
    ...existing,
    transcript: trimTranscript(transcript, MAX_OUTPUT_CHARS),
    lastEventAt: at,
  });
  return { ...state, agents, agentOrder };
}

/** Adds the operator's own message as a user turn, immediately and client-side — the server
 * never sends it back over SSE, so this is the only place the user's side of the
 * conversation is recorded (Round 6, docs/handoffs/tui.md). Always starts a fresh turn: a
 * user turn never merges with anything, even a preceding user turn, since each send is a
 * distinct message. */
function appendUserTurn(state: TuiState, agentId: string, at: number, message: string): TuiState {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId) ?? defaultAgent(agentId, at);
  const agentOrder = agents.has(agentId) ? state.agentOrder : [...state.agentOrder, agentId];
  const transcript = [...existing.transcript, { role: "user" as const, text: message }];
  agents.set(agentId, {
    ...existing,
    transcript: trimTranscript(transcript, MAX_OUTPUT_CHARS),
    lastEventAt: at,
  });
  return { ...state, agents, agentOrder };
}

function noEffects(state: TuiState): ReducerResult {
  return { state, effects: [] };
}

export function reducer(state: TuiState, action: Action): ReducerResult {
  switch (action.type) {
    case "sse_event":
      return handleSseEvent(state, action.event);
    case "tree_response":
      return noEffects(applyTreeResponse(state, action.tree));
    case "command_error":
      return noEffects({ ...state, statusMessage: action.error });
    case "resize":
      return noEffects({ ...state, size: { rows: action.rows, cols: action.cols } });
    case "connection":
      return noEffects({ ...state, connection: action.status });
    case "reconnected":
      return noEffects({
        ...state,
        reconnectNotice: "Reconnected — history may be incomplete.",
      });
    case "key":
      return handleKey(state, action.key);
    case "tick":
      return noEffects({ ...state, now: action.now });
  }
}

function handleSseEvent(state: TuiState, event: ServerSentEvent): ReducerResult {
  const at = parseEventTime(event.timestamp);
  switch (event.type) {
    case "agent_spawned": {
      let next = withAgent(state, event.agentId, at, {
        parentAgentId: event.parentAgentId,
        model: event.model,
      });
      if (event.parentAgentId === null && next.rootAgentId === null) {
        next = { ...next, rootAgentId: event.agentId };
      }
      return noEffects(next);
    }
    case "agent_output":
      return noEffects(appendOutput(state, event.agentId, at, event.chunk));
    case "agent_status":
      return noEffects(withAgent(state, event.agentId, at, { status: event.status }));
    case "token_usage":
      return noEffects(
        withAgent(state, event.agentId, at, {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd ?? null,
        }),
      );
    case "session_ended":
      return noEffects({ ...state, sessionEnded: { exitCode: event.exitCode } });
  }
}

/**
 * Applies a `request_agent_tree` response to state. Also seeds `rootAgentId` (when not
 * already known) from the tree itself — the entry with `parentAgentId === null` — rather
 * than waiting on a live `agent_spawned` SSE event. Without this, a fresh session deadlocks:
 * `agent_spawned` doesn't fire until the loop actually starts, which requires sending a
 * first message, which `handleRootKey`'s `enter` case refuses without a known
 * `rootAgentId` (see Round 3 in docs/handoffs/tui.md). `app.ts` fires `request_agent_tree`
 * automatically on startup so this runs before the operator ever types anything.
 */
function applyTreeResponse(state: TuiState, tree: TuiState["tree"]): TuiState {
  let next: TuiState = { ...state, tree };
  if (tree) {
    const flat = flattenTree(tree);
    if (next.rootAgentId === null) {
      const rootEntry = flat.find((entry) => entry.node.parentAgentId === null);
      if (rootEntry) next = { ...next, rootAgentId: rootEntry.node.agentId };
    }
    if (next.view.kind === "tree") {
      const clamped = flat.length === 0 ? 0 : Math.min(next.view.selectedIndex, flat.length - 1);
      next = { ...next, view: { kind: "tree", selectedIndex: clamped } };
    }
  }
  return next;
}

function handleKey(state: TuiState, key: KeyEvent): ReducerResult {
  if (key.kind === "ctrl_c") {
    return { state, effects: [{ type: "quit" }] };
  }

  switch (state.view.kind) {
    case "root":
      return handleRootKey(state, key);
    case "tree":
      return noEffects(handleTreeKey(state, state.view, key));
    case "agent":
      return noEffects(handleAgentKey(state, key));
  }
}

/** Insert `text` into `input` at `cursor`, returning the new string and the cursor position
 * just past the inserted text. Shared by plain character entry and paste (DH-0026) so both
 * go through one code path rather than duplicating splice logic. */
function insertAt(input: string, cursor: number, text: string): { input: string; cursor: number } {
  return {
    input: input.slice(0, cursor) + text + input.slice(cursor),
    cursor: cursor + text.length,
  };
}

function handleRootKey(state: TuiState, key: KeyEvent): ReducerResult {
  // Left-arrow is only reserved for "open the agent tree" when the input box is empty —
  // otherwise it repositions the cursor within typed text like every other editor (DH-0026).
  if (key.kind === "left" && state.input === "") {
    return {
      state: { ...state, view: { kind: "tree", selectedIndex: 0 }, statusMessage: null },
      effects: [{ type: "send_command", command: { type: "request_agent_tree" } }],
    };
  }
  if (key.kind === "left") {
    return noEffects({ ...state, inputCursor: Math.max(0, state.inputCursor - 1) });
  }
  if (key.kind === "right") {
    return noEffects({
      ...state,
      inputCursor: Math.min(state.input.length, state.inputCursor + 1),
    });
  }
  if (key.kind === "home") {
    return noEffects({ ...state, inputCursor: 0 });
  }
  if (key.kind === "end") {
    return noEffects({ ...state, inputCursor: state.input.length });
  }
  if (key.kind === "char") {
    const { input, cursor } = insertAt(state.input, state.inputCursor, key.value);
    return noEffects({ ...state, input, inputCursor: cursor });
  }
  if (key.kind === "paste") {
    // Literal insert, including any embedded newlines — never re-parsed as `enter`
    // keystrokes, which is exactly the fragmentation bug DH-0026 exists to fix.
    const { input, cursor } = insertAt(state.input, state.inputCursor, key.text);
    return noEffects({ ...state, input, inputCursor: cursor });
  }
  if (key.kind === "backspace") {
    if (state.inputCursor === 0) return noEffects(state);
    const input =
      state.input.slice(0, state.inputCursor - 1) + state.input.slice(state.inputCursor);
    return noEffects({ ...state, input, inputCursor: state.inputCursor - 1 });
  }
  if (key.kind === "delete") {
    if (state.inputCursor >= state.input.length) return noEffects(state);
    const input =
      state.input.slice(0, state.inputCursor) + state.input.slice(state.inputCursor + 1);
    return noEffects({ ...state, input });
  }
  if (key.kind === "enter") {
    if (state.input.trim() === "") return noEffects(state);
    if (state.rootAgentId === null) {
      return noEffects({ ...state, statusMessage: "No root agent yet — please wait." });
    }
    const message = state.input;
    const withUserTurn = appendUserTurn(state, state.rootAgentId, state.now, message);
    return {
      state: { ...withUserTurn, input: "", inputCursor: 0, statusMessage: null },
      effects: [
        {
          type: "send_command",
          command: { type: "send_message", agentId: state.rootAgentId, message },
        },
      ],
    };
  }
  if (key.kind === "escape") {
    return noEffects({ ...state, statusMessage: null, reconnectNotice: null });
  }
  // "tab" is intentionally a no-op here — reserved for a possible future completion feature,
  // not a dead/unhandled key (DH-0026 flagged it as unclear; this makes the intent explicit).
  return noEffects(state);
}

/**
 * `view` is passed separately (already narrowed by the caller's switch on `state.view.kind`)
 * so this function needs no defensive re-check — every branch here is reachable.
 */
function handleTreeKey(
  state: TuiState,
  view: { kind: "tree"; selectedIndex: number },
  key: KeyEvent,
): TuiState {
  const flat = flattenTree(state.tree ?? []);
  if (key.kind === "up") {
    return { ...state, view: { kind: "tree", selectedIndex: Math.max(0, view.selectedIndex - 1) } };
  }
  if (key.kind === "down") {
    const max = Math.max(0, flat.length - 1);
    return {
      ...state,
      view: { kind: "tree", selectedIndex: Math.min(max, view.selectedIndex + 1) },
    };
  }
  if (key.kind === "enter") {
    const entry = flat[view.selectedIndex];
    if (!entry) return state;
    const agentId = entry.node.agentId;
    if (agentId === state.rootAgentId) {
      return { ...state, view: { kind: "root" } };
    }
    return { ...state, view: { kind: "agent", agentId } };
  }
  if (key.kind === "left" || key.kind === "escape") {
    return { ...state, view: { kind: "root" } };
  }
  return state;
}

function handleAgentKey(state: TuiState, key: KeyEvent): TuiState {
  if (key.kind === "escape") {
    return { ...state, view: { kind: "root" } };
  }
  if (key.kind === "char" && key.value === "q") {
    return { ...state, view: { kind: "root" } };
  }
  return state;
}
