// Pure application state + reducer: (state, action) -> { state, effects }. No I/O happens
// here — side effects (HTTP commands, process exit) are described as data and executed by
// app.ts. This is what makes the TUI's core logic fully unit-testable without a terminal.

import type { AgentStatus, ModelInfo, ServerSentEvent } from "../contracts/index.ts";
import { parseSlashCommand } from "./commands.ts";
import type { KeyEvent } from "./keys.ts";
import { flattenTree } from "./tree.ts";
import type { Action, AgentInfo, ReducerResult, TuiState, Turn } from "./types.type.ts";
import { codePointLength, sliceCodePoints } from "./width.ts";

/** Bound per-agent transcript buffer (total chars across all turns) so a very long session
 * doesn't grow memory unboundedly. Documented, intentional cap — not a silent truncation of
 * what the user can see live: oldest turns are dropped first, newest content is always kept
 * in full. */
export const MAX_OUTPUT_CHARS = 200_000;

/** DH-0012: cap the `agents` map at this many *terminal* (done/failed/stopped) entries,
 * oldest evicted first — active (non-terminal) agents are never evicted regardless of count.
 * Matches the owner's fixed-count-cap decision applied consistently across Core/Server/TUI/
 * Web; `Server`/`Core` wire the same default through a `dh.json` `limits.completedRetention`
 * knob (see tracking/DH-0012) — the TUI doesn't yet read `dh.json` directly (that's Core's
 * `src/cli.ts`/`startTui` wiring boundary), so this is the TUI's own default until a config
 * value is threaded through the same way `token` was (see docs/roster/mary.md Round 2). */
export const DEFAULT_COMPLETED_RETENTION = 50;

const TERMINAL_STATUSES = Object.freeze(new Set(["done", "failed", "stopped"]));

/** Evict the oldest terminal (done/failed/stopped) agents from `state.agents`/`agentOrder`
 * beyond `retention` most-recent terminal entries. Active agents (running/waiting) are never
 * evicted, so `retention` bounds only the "how much history sticks around" question, never
 * "how many agents can be in flight" — an unbounded number of live agents is still tracked,
 * matching the ticket's "active entries never evicted regardless of count" requirement. */
function evictCompletedAgents(state: TuiState, retention: number): TuiState {
  const terminalIds = state.agentOrder.filter((id) => {
    const agent = state.agents.get(id);
    return agent !== undefined && TERMINAL_STATUSES.has(agent.status);
  });
  if (terminalIds.length <= retention) return state;
  const toEvict = new Set(terminalIds.slice(0, terminalIds.length - retention));
  if (toEvict.size === 0) return state;
  const agents = new Map(state.agents);
  for (const id of toEvict) agents.delete(id);
  const agentOrder = state.agentOrder.filter((id) => !toEvict.has(id));
  return { ...state, agents, agentOrder };
}

/** Drop oldest turns (and, if needed, trim the oldest remaining turn's text) until the total
 * character count across `transcript` is at or under `max`. Trims by codepoint, not UTF-16
 * code unit (`width.ts`'s `sliceCodePoints`), so a trim boundary never splits a surrogate
 * pair into a corrupted lone surrogate (DH-0025). */
function trimTranscript(transcript: Turn[], max: number): Turn[] {
  let total = transcript.reduce((sum, turn) => sum + codePointLength(turn.text), 0);
  if (total <= max) return transcript;
  const out = [...transcript];
  while (out.length > 0 && total > max) {
    const oldest = out[0];
    if (!oldest) break;
    const oldestLength = codePointLength(oldest.text);
    const excess = total - max;
    if (oldestLength <= excess) {
      total -= oldestLength;
      out.shift();
    } else {
      out[0] = { ...oldest, text: sliceCodePoints(oldest.text, oldestLength - excess, true) };
      total -= excess;
    }
  }
  return out;
}

/** DH-0059: how long the TUI lingers on the final "session ended (exit N)" frame after
 * `session_ended` arrives (during an operator-initiated shutdown) before actually quitting
 * — long enough for a slow terminal/capture to observe it (e2e's poll is 150ms), short
 * enough not to feel like a hang. */
export const SESSION_ENDED_LINGER_MS = 1000;

export function initialState(
  size: { rows: number; cols: number },
  opts: { ownsServer?: boolean } = {},
): TuiState {
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
    ownsServer: opts.ownsServer ?? false,
    shutdownRequested: false,
    rootActive: false,
    skills: null,
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
    pendingToolCall: null,
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

/** Append a synthetic `"tool"` marker turn to `agentId`'s transcript. Originally DH-0065's
 * sub-agent-spawn marker (inferred client-side from `agent_spawned`); DH-0089 reuses it for
 * the generic `tool_call` marker too, now that a real SSE event exists for that. Always
 * starts a fresh turn, like a user turn — a marker never merges with a neighboring turn. */
function appendToolMarker(state: TuiState, agentId: string, at: number, text: string): TuiState {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId) ?? defaultAgent(agentId, at);
  const agentOrder = agents.has(agentId) ? state.agentOrder : [...state.agentOrder, agentId];
  const transcript = [...existing.transcript, { role: "tool" as const, text }];
  agents.set(agentId, {
    ...existing,
    transcript: trimTranscript(transcript, MAX_OUTPUT_CHARS),
    lastEventAt: at,
  });
  return { ...state, agents, agentOrder };
}

/** Append a `"tool"` marker turn tagged with `terminalStatus` (DH-0130) so the render layer
 * can style it via DH-0137's status tokens instead of the generic dim tool-marker styling. */
function appendTerminalMarker(
  state: TuiState,
  agentId: string,
  at: number,
  status: AgentStatus,
): TuiState {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId) ?? defaultAgent(agentId, at);
  const agentOrder = agents.has(agentId) ? state.agentOrder : [...state.agentOrder, agentId];
  const transcript = [
    ...existing.transcript,
    { role: "tool" as const, text: `Agent ${status}`, terminalStatus: status },
  ];
  agents.set(agentId, {
    ...existing,
    transcript: trimTranscript(transcript, MAX_OUTPUT_CHARS),
    lastEventAt: at,
  });
  return { ...state, agents, agentOrder };
}

/** DH-0089 `tool_call` handler: appends the generic "toolName: inputSummary" marker and
 * records the new turn's index as `pendingToolCall` so the matching `tool_result` can find
 * it again. Per D5, `toolName === "Agent"` is suppressed entirely here — DH-0065's richer
 * spawn marker (driven by `agent_spawned`) already covers spawns, and rendering both would
 * double-mark every one; a failed spawn is still surfaced because its `tool_result` (with no
 * matching pending entry) falls through to the standalone-error-marker branch below. */
function handleToolCall(
  state: TuiState,
  event: Extract<ServerSentEvent, { type: "tool_call" }>,
  at: number,
): TuiState {
  if (event.toolName === "Agent") return state;
  const next = appendToolMarker(
    state,
    event.agentId,
    at,
    `${event.toolName}: ${event.inputSummary}`,
  );
  const agent = next.agents.get(event.agentId);
  if (!agent) return next;
  const agents = new Map(next.agents);
  agents.set(event.agentId, {
    ...agent,
    pendingToolCall: { toolUseId: event.toolUseId, turnIndex: agent.transcript.length - 1 },
  });
  return { ...next, agents };
}

/** DH-0089 `tool_result` handler. If this resolves an outstanding `pendingToolCall` (the
 * common case), marks that same marker turn as errored (no-op on success — "leave the marker
 * unchanged" per D5) and clears the pending entry. Otherwise (resume gap, or a suppressed
 * `Agent` `tool_call`) renders a standalone `"toolName ✗"` marker when `isError`, and drops
 * the event entirely on success — nothing to show for an unremarkable, already-invisible
 * call. */
function handleToolResult(
  state: TuiState,
  event: Extract<ServerSentEvent, { type: "tool_result" }>,
  at: number,
): TuiState {
  const agent = state.agents.get(event.agentId);
  const pending = agent?.pendingToolCall;
  if (agent && pending && pending.toolUseId === event.toolUseId) {
    const agents = new Map(state.agents);
    const turn = agent.transcript[pending.turnIndex];
    const transcript = turn
      ? agent.transcript.map((t, i) =>
          i === pending.turnIndex && event.isError ? { ...t, toolError: true } : t,
        )
      : agent.transcript;
    agents.set(event.agentId, { ...agent, transcript, pendingToolCall: null, lastEventAt: at });
    return { ...state, agents };
  }
  if (!event.isError) return state;
  return appendToolMarker(state, event.agentId, at, `${event.toolName} ✗`);
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
    case "models_response":
      // DH-0093: `/model` (no-arg) sent `list_models` and is now transitioning root -> picker.
      // Select the currently-active model by default so Enter with no navigation re-confirms
      // the status quo rather than landing on an arbitrary row.
      return noEffects({
        ...state,
        view: {
          kind: "picker",
          options: action.models,
          selectedIndex: Math.max(
            0,
            action.models.findIndex((m) => m.isActive),
          ),
        },
      });
    case "skills_response":
      return noEffects({ ...state, skills: action.skills });
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
        next = { ...next, rootAgentId: event.agentId, rootActive: true };
      } else if (event.parentAgentId !== null) {
        const label = event.description ? `: "${event.description}"` : "";
        next = appendToolMarker(next, event.parentAgentId, at, `Agent(${event.model})${label}`);
      }
      return noEffects(next);
    }
    case "agent_output": {
      const next = appendOutput(state, event.agentId, at, event.chunk);
      return noEffects(event.agentId === state.rootAgentId ? { ...next, rootActive: true } : next);
    }
    case "agent_status": {
      const prior = state.agents.get(event.agentId);
      let next = withAgent(state, event.agentId, at, { status: event.status });
      if (TERMINAL_STATUSES.has(event.status) && prior?.status !== event.status) {
        next = appendTerminalMarker(next, event.agentId, at, event.status);
      }
      return noEffects(evictCompletedAgents(next, DEFAULT_COMPLETED_RETENTION));
    }
    case "token_usage": {
      // DH-0028: `token_usage` carries a per-turn *delta* (confirmed from
      // src/agent/loop.ts/providers — one event per provider completion call, sourced
      // directly from that call's own `usage` field, never a conversation-wide running
      // total), so the handler must accumulate into the running per-agent totals, not
      // replace them. Web's client.ts already does this correctly; this was the TUI bug.
      const existing = state.agents.get(event.agentId);
      const priorCost = existing?.costUsd ?? null;
      const nextCost = event.costUsd === undefined ? priorCost : (priorCost ?? 0) + event.costUsd;
      const next = withAgent(state, event.agentId, at, {
        inputTokens: (existing?.inputTokens ?? 0) + event.inputTokens,
        outputTokens: (existing?.outputTokens ?? 0) + event.outputTokens,
        costUsd: nextCost,
      });
      return noEffects(event.agentId === state.rootAgentId ? { ...next, rootActive: true } : next);
    }
    case "session_ended": {
      const next: TuiState = { ...state, sessionEnded: { exitCode: event.exitCode } };
      // DH-0059: this is the completion side of an operator-initiated Ctrl+C shutdown
      // (handleKey's ctrl_c rule 3 sent stop_agent and set shutdownRequested) — quit, but
      // only after the current frame (which now renders "session ended (exit N)") has had
      // a chance to actually draw; see the Effect.quit doc comment for why `afterMs` exists.
      if (state.shutdownRequested) {
        return { state: next, effects: [{ type: "quit", afterMs: SESSION_ENDED_LINGER_MS }] };
      }
      return noEffects(next);
    }
    case "resync":
      return noEffects({
        ...state,
        reconnectNotice: "Reconnected — history may be incomplete.",
      });
    // DH-0093: the real client-side consumption of `model_switched` (the backend round only
    // added a no-op exhaustiveness case) — update the switched agent's displayed model and,
    // for the root agent, surface a status message so the operator sees confirmation even if
    // they weren't the one who triggered it (e.g. a future non-interactive trigger).
    case "model_switched": {
      const next = withAgent(state, event.agentId, at, { model: event.to });
      const withStatus =
        event.agentId === state.rootAgentId
          ? { ...next, statusMessage: `model switched to ${event.to}` }
          : next;
      return noEffects(withStatus);
    }
    case "tool_call":
      return noEffects(handleToolCall(state, event, at));
    case "tool_result":
      return noEffects(handleToolResult(state, event, at));
    // DH-0045: `agent_thinking` is a new additive SSE event type (Core's piece of DH-0045),
    // not yet in sse-parser.ts's KNOWN_TYPES, so it never actually reaches this reducer at
    // runtime; this case exists purely to keep this switch's exhaustiveness check compiling.
    // Full TUI display is deferred to a later round (mirrors Web's state.ts treatment).
    case "agent_thinking":
      return noEffects(state);
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

/** DH-0059 Ctrl+C rules (see the ticket's §2 for the full design):
 *
 * 1. `ownsServer === false` (a `--connect` client) — quit immediately, unchanged behavior:
 *    the agent lives in a server this process doesn't own, so Ctrl+C only detaches.
 * 2. `ownsServer === true` but there's nothing to stop — the session already ended, the
 *    root was never active (a `stop_agent` on a never-started root is a no-op and
 *    `session_ended` would never arrive), or `rootAgentId` is still unknown — quit
 *    immediately, no shutdown wait.
 * 3. `ownsServer === true`, root has been active, first press — send `stop_agent` for the
 *    root, set `shutdownRequested`, and show a "stopping…" hint. `session_ended` (handled
 *    in `handleSseEvent` above) completes the shutdown with a deferred quit.
 * 4. `ownsServer === true`, second press (`shutdownRequested` already set) — force quit;
 *    the escape hatch for a stop that never completes (e.g. a tool call still blocking).
 */
function handleCtrlC(state: TuiState): ReducerResult {
  if (!state.ownsServer) {
    return { state, effects: [{ type: "quit" }] };
  }
  if (state.shutdownRequested) {
    return { state, effects: [{ type: "quit" }] };
  }
  if (state.sessionEnded !== null || !state.rootActive || state.rootAgentId === null) {
    return { state, effects: [{ type: "quit" }] };
  }
  return {
    state: {
      ...state,
      shutdownRequested: true,
      statusMessage: "stopping session… (Ctrl+C again to force quit)",
    },
    effects: [
      {
        type: "send_command",
        command: { type: "stop_agent", agentId: state.rootAgentId },
      },
    ],
  };
}

function handleKey(state: TuiState, key: KeyEvent): ReducerResult {
  if (key.kind === "ctrl_c") {
    return handleCtrlC(state);
  }

  switch (state.view.kind) {
    case "root":
      return handleRootKey(state, key);
    case "tree":
      return noEffects(handleTreeKey(state, state.view, key));
    case "agent":
      return noEffects(handleAgentKey(state, key));
    case "picker":
      return handlePickerKey(state, state.view, key);
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
    // DH-0093: a recognized slash command never becomes a chat message — intercepted here,
    // the one place a `send_message` effect is built from `state.input` (design §1). The raw
    // (untrimmed) input is tested: a leading space before the slash, or a bare "/" alone,
    // deliberately fails to match and falls through to ordinary chat, per the grammar's own
    // rules (see commands.ts).
    const parsed = parseSlashCommand(state.input);
    if (parsed) {
      return handleSlashCommand(state, parsed.name, parsed.args);
    }
    if (state.rootAgentId === null) {
      return noEffects({ ...state, statusMessage: "No root agent yet — please wait." });
    }
    const message = state.input;
    const withUserTurn = appendUserTurn(state, state.rootAgentId, state.now, message);
    return {
      state: {
        ...withUserTurn,
        input: "",
        inputCursor: 0,
        statusMessage: null,
        rootActive: true,
      },
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

/** Local, never-sent transcript entry text for `/help` (DH-0093 design §3) — lists the
 * built-ins plus every cached skill command, and is explicit that `/clear` only affects the
 * local view (honest labeling instead of a silent semantic lie about resetting context). */
function helpText(state: TuiState): string {
  const lines = [
    "Available commands:",
    "  /model [name]   show/switch the active model (no arg opens a picker)",
    "  /help           show this message",
    "  /clear          clear the local transcript view (does NOT reset the agent's context)",
  ];
  const skills = state.skills ?? [];
  if (skills.length > 0) {
    lines.push("");
    lines.push("Skill commands:");
    for (const skill of skills) {
      lines.push(`  /${skill.name}   ${skill.description}`);
    }
  }
  return lines.join("\n");
}

/** Dispatch a parsed slash command (DH-0093 design §1-4). Never produces a `send_message`
 * effect — that's the whole point of interception. `/model`/skill invocation need a root
 * agent id (mirroring the existing chat-message guard); `/help`/`/clear` are fully local and
 * work even before one exists. */
function handleSlashCommand(state: TuiState, name: string, args: string): ReducerResult {
  const cleared: TuiState = { ...state, input: "", inputCursor: 0 };

  if (name === "help") {
    if (state.rootAgentId === null) {
      return noEffects({ ...cleared, statusMessage: helpText(state) });
    }
    return noEffects(appendToolMarker(cleared, state.rootAgentId, state.now, helpText(state)));
  }

  if (name === "clear") {
    // DH-0093 design §3: clears the local transcript view only — every tracked agent's
    // display resets, but no wire command is sent and the agent's own in-memory context is
    // deliberately unaffected in v1 (see helpText's explicit disclosure of this).
    const agents = new Map(cleared.agents);
    for (const [id, agent] of agents) agents.set(id, { ...agent, transcript: [] });
    return noEffects({ ...cleared, agents, statusMessage: null });
  }

  if (state.rootAgentId === null) {
    return noEffects({ ...cleared, statusMessage: "No root agent yet — please wait." });
  }
  const rootAgentId = state.rootAgentId;

  if (name === "model") {
    const trimmedArgs = args.trim();
    if (trimmedArgs === "") {
      // No-arg form: fetch the list; `models_response` transitions into the picker.
      return {
        state: cleared,
        effects: [{ type: "send_command", command: { type: "list_models" } }],
      };
    }
    // Argument form: switch directly, skipping the picker (design §2).
    return {
      state: { ...cleared, statusMessage: `switching model to ${trimmedArgs}…` },
      effects: [
        {
          type: "send_command",
          command: { type: "switch_model", agentId: rootAgentId, model: trimmedArgs },
        },
      ],
    };
  }

  // Not a built-in — try a skill command (BUILTIN_COMMAND_NAMES shadow same-named skills,
  // per design §4; isBuiltinCommandName above already exhausted the three built-ins, so
  // reaching here means `name` is not one of them).
  const skill = (state.skills ?? []).find((s) => s.name === name);
  if (skill) {
    // Local echo of the raw "/name args" the operator typed (design §4) — the expanded
    // skill content is never shown here, only visible in the JSONL log as the real user
    // message the server composes and delivers via the ordinary sendMessage path.
    const echo = args.trim() === "" ? `/${name}` : `/${name} ${args}`;
    const withEcho = appendUserTurn(cleared, rootAgentId, state.now, echo);
    return {
      state: { ...withEcho, rootActive: true },
      effects: [
        {
          type: "send_command",
          command: { type: "invoke_skill", agentId: rootAgentId, skill: name, args },
        },
      ],
    };
  }

  return noEffects({ ...cleared, statusMessage: `Unknown command: /${name}` });
}

/** Navigation for the `/model` picker (design §2): up/down move, enter selects (sends
 * `switch_model` and returns to the root view), escape cancels back to root with no command
 * sent — the exact same shape as `handleTreeKey`. */
function handlePickerKey(
  state: TuiState,
  view: { kind: "picker"; options: ModelInfo[]; selectedIndex: number },
  key: KeyEvent,
): ReducerResult {
  if (key.kind === "up") {
    return noEffects({
      ...state,
      view: { ...view, selectedIndex: Math.max(0, view.selectedIndex - 1) },
    });
  }
  if (key.kind === "down") {
    const max = Math.max(0, view.options.length - 1);
    return noEffects({
      ...state,
      view: { ...view, selectedIndex: Math.min(max, view.selectedIndex + 1) },
    });
  }
  if (key.kind === "enter") {
    const selected = view.options[view.selectedIndex];
    if (!selected || state.rootAgentId === null) {
      return noEffects({ ...state, view: { kind: "root" } });
    }
    return {
      state: {
        ...state,
        view: { kind: "root" },
        statusMessage: `switching model to ${selected.name}…`,
      },
      effects: [
        {
          type: "send_command",
          command: { type: "switch_model", agentId: state.rootAgentId, model: selected.name },
        },
      ],
    };
  }
  if (key.kind === "escape" || key.kind === "left") {
    return noEffects({ ...state, view: { kind: "root" } });
  }
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
