// TUI-internal state types. These are *not* wire types — wire types are imported from
// src/contracts/ wherever they're needed (see state.ts, render.ts). This module only
// describes the client's own view/application state and the pure reducer's vocabulary.
//
// DH-0157: `ConnectionStatus`/`CONNECTION_STATUSES` moved out to a constant module (this file
// may only hold type/interface declarations per the .type.ts standing rule; that pair mixed a
// constant in, which is now split out). DH-0183: that module is now
// `src/client-core/connection-status.ts`, shared with the Web client.

import type { ConnectionStatus } from "../client-core/connection-status.ts";
import type {
  AgentStatus,
  AgentTreeNode,
  ClientCommand,
  ModelInfo,
  ServerSentEvent,
  SkillInfo,
} from "../contracts/index.ts";
import type { KeyEvent } from "./keys.ts";

// DH-0093: `/model` (no arg) picker view — navigated exactly like the tree view
// (up/down move, enter selects, escape cancels back to root).
export type ViewState =
  | { kind: "root" }
  | { kind: "tree"; selectedIndex: number }
  | { kind: "agent"; agentId: string }
  | { kind: "picker"; options: ModelInfo[]; selectedIndex: number };

/** One turn of a conversation transcript. `"user"` turns are added client-side, immediately,
 * the moment the operator hits Enter — the server never echoes the operator's own messages
 * back over SSE, so this is the only place they're recorded (Round 6,
 * docs/handoffs/tui.md). `"assistant"` turns accumulate streamed `agent_output` chunks:
 * consecutive chunks with no intervening user turn append to the same turn's `text` rather
 * than starting a new one, so one streamed model response reads as a single turn.
 *
 * `"tool"` turns (DH-0065) are synthetic, client-inserted markers for activity the operator
 * would otherwise never see in the transcript — currently just a sub-agent spawn, inferred
 * from an `agent_spawned` event whose `parentAgentId` names a tracked agent (no dedicated
 * SSE event carries generic tool-call boundaries yet; see state.ts's `appendToolMarker` doc
 * comment for why plain tool calls like Bash/Read aren't covered here). Always its own turn,
 * never merged with a neighboring turn of any role. */
export interface Turn {
  role: "user" | "assistant" | "tool";
  text: string;
  /** DH-0089: set on a `"tool"` turn once its matching `tool_result` reports `isError: true`
   * — render.ts appends a red "✗" for these instead of baking raw ANSI into `text` (which
   * would be stripped by `sanitizeText`'s defensive escape-stripping before wrapping).
   * Meaningless on `"user"`/`"assistant"` turns. */
  toolError?: boolean;
  /** DH-0130: set on a `"tool"` turn synthesized when an agent (root or sub-agent) reaches a
   * terminal status (done/failed/stopped) — lets the transcript pane render this marker using
   * DH-0137's status tokens (glyph/color/word) instead of the generic dim "⚙" tool-call
   * styling, so a sub-agent's failure is visible in its own transcript, not just the sidebar. */
  terminalStatus?: AgentStatus;
  /** DH-0246: wall-clock duration (ms) of the matching `tool_result`, set once it resolves a
   * `"tool"` marker turn's `pendingToolCall` — mirrors `src/web/client/state.ts`'s identical
   * field (DH-0199). `ToolResultEvent` deliberately carries no output content (see its doc
   * comment in `src/contracts/events.type.ts`), so duration + success/failure (`toolError`) is
   * the full "result" `TranscriptPane`'s tool-call detail expansion can ever show. */
  durationMs?: number;
}

export interface AgentInfo {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  status: AgentStatus;
  /** Ordered conversation turns, replacing the old flat `output: string` (Round 6) so the
   * render layer can draw real turn separation and show the user's own messages instead of
   * one unbroken wall of concatenated model output. */
  transcript: Turn[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** Epoch ms of the most recent SSE event seen for this agent (any type — spawn, output,
   * status, token usage). A liveness signal ("last heard from at") distinct from
   * `statusSince`: it resets on every event, so a `running` agent that has gone quiet is
   * visibly distinguishable from one still actively streaming (Round 5,
   * docs/handoffs/tui.md). */
  lastEventAt: number;
  /** Epoch ms when `status` last changed — answers "how long in this status", as opposed to
   * `lastEventAt`'s "how long since anything happened at all". */
  statusSince: number;
  /** DH-0089: the transcript index of the marker turn created by the most recent unresolved
   * `tool_call` for this agent, keyed by its `toolUseId` — lets the matching `tool_result`
   * append an error suffix to the same turn rather than creating a new one. `null` when no
   * tool call is outstanding (or the outstanding one was suppressed, e.g. `toolName ===
   * "Agent"` — see state.ts's `handleSseEvent`). Cleared once the matching `tool_result`
   * arrives. */
  pendingToolCall: { toolUseId: string; turnIndex: number } | null;
}

export interface TuiState {
  view: ViewState;
  agents: Map<string, AgentInfo>;
  /** Creation order of agents, for a stable fallback ordering before a tree is fetched. */
  agentOrder: string[];
  rootAgentId: string | null;
  tree: AgentTreeNode[] | null;
  input: string;
  /** Index into `input` where the next typed character / backspace / delete / paste applies.
   * Always in `[0, input.length]`. Introduced for DH-0026: previously the input box only
   * ever appended to (or trimmed from) the end of `input`, so there was no way to reposition
   * within typed text — left/right/Home/End now move this instead. */
  inputCursor: number;
  connection: ConnectionStatus;
  sessionEnded: { exitCode: number } | null;
  size: { rows: number; cols: number };
  statusMessage: string | null;
  /** Set when the SSE client reconnects after one or more failed attempts (DH-0024). Client
   * has no way yet to know for certain whether it actually missed events during the drop
   * (that requires a server-side gap signal — see DH-0019, not yet landed) or whether the
   * server itself restarted mid-session (a brand new event stream that happens to look like
   * a normal resume), so this is an honest best-effort "something happened, take a look"
   * flag rather than a precise diagnosis. Cleared on the next `enter`/`escape` in the root
   * view, same lifecycle as `statusMessage`. */
  reconnectNotice: string | null;
  /** Current wall-clock time (epoch ms), as known to the reducer. Set by `initialState`
   * (real `Date.now()`) and advanced only via the `tick` action — never read implicitly at
   * render time — so `render.ts` stays a pure function of state and tests can inject an
   * arbitrary fake clock instead of sleeping. Drives the tree/agent-view liveness indicator
   * (elapsed = now - agent.lastEventAt). */
  now: number;
  /** DH-0059: true when this process also constructed the `DhServer` this TUI talks to
   * (local mode) — false for a `--connect` client attached to a server it doesn't own.
   * Seeded once at construction (`initialState`'s second argument) from `startTui`'s
   * `ownsServer` option; only `src/cli.ts` knows which branch it took, so this can't be
   * inferred from anything the TUI itself observes (see DH-0059 for the full reasoning).
   * Drives whether Ctrl+C sends `stop_agent` before quitting. */
  ownsServer: boolean;
  /** DH-0059: set on the first Ctrl+C when `ownsServer` is true and the root has been
   * active — a `stop_agent` command has been sent and the TUI is now waiting for
   * `session_ended` before it quits. A second Ctrl+C while this is true force-quits
   * immediately (the escape hatch for a stop that never completes). */
  shutdownRequested: boolean;
  /** DH-0059: true once the root agent has produced any real activity (an `agent_spawned`,
   * `agent_output`, or `token_usage` event for it, or the operator has sent it a message) —
   * as opposed to merely being known about via the startup `request_agent_tree` bootstrap,
   * which synthesizes a root node before the loop has ever actually started. Ctrl+C only
   * sends `stop_agent` when this is true; `stop_agent` on a never-started root is a no-op
   * and `session_ended` would never arrive, so Ctrl+C quits immediately instead. */
  rootActive: boolean;
  /** DH-0093: cached `list_skills` result, fetched once at startup (app.ts, alongside
   * `request_agent_tree`) so `/help` and `/<skillname>` resolve locally with no per-keystroke
   * round-trip. `null` until the first response arrives. */
  skills: SkillInfo[] | null;
  /** DH-0142: index of the currently-highlighted entry in the slash-command autocomplete
   * dropdown (only meaningful while the dropdown is showing — see `visibleAutocomplete` in
   * state.ts). Reset to 0 whenever the input changes, so the highlight always starts on the
   * top match for a fresh query. */
  dropdownIndex: number;
  /** DH-0142: true once the operator has explicitly dismissed the autocomplete dropdown for
   * the current input (Escape) — the dropdown is derived from `input`/`skills` on every
   * render, so this is the only piece of state needed to suppress it until the next
   * input-changing keystroke resets it back to `false`. */
  dropdownDismissed: boolean;
}

export type Action =
  | { type: "sse_event"; event: ServerSentEvent }
  | { type: "tree_response"; tree: AgentTreeNode[] }
  | { type: "command_error"; error: string }
  | { type: "key"; key: KeyEvent }
  | { type: "resize"; rows: number; cols: number }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "reconnected" }
  | { type: "tick"; now: number }
  // DH-0093: response actions for the two new list_* commands. `models_response` also drives
  // the `/model` (no-arg) transition into the picker view.
  | { type: "models_response"; models: ModelInfo[] }
  | { type: "skills_response"; skills: SkillInfo[] };

export type Effect =
  | { type: "send_command"; command: ClientCommand }
  /** DH-0059: `afterMs`, when set, means "draw the current frame first, then quit after
   * this many ms" — used for the deferred quit on `session_ended` so the "session ended
   * (exit N)" frame actually paints before the terminal is torn down (see app.ts's
   * `dispatch()` doc comment for why this matters: effects run before the frame is drawn,
   * so an immediate cleanup would tear the terminal down before the frame ever rendered). */
  | { type: "quit"; afterMs?: number };

export interface ReducerResult {
  state: TuiState;
  effects: Effect[];
}
