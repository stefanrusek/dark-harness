// TUI-internal state types. These are *not* wire types — wire types are imported from
// src/contracts/ wherever they're needed (see state.ts, render.ts). This module only
// describes the client's own view/application state and the pure reducer's vocabulary.

import type {
  AgentStatus,
  AgentTreeNode,
  ClientCommand,
  ServerSentEvent,
} from "../contracts/index.ts";
import type { KeyEvent } from "./keys.ts";

export type ConnectionStatus = "connecting" | "open" | "error" | "closed";

export type ViewState =
  | { kind: "root" }
  | { kind: "tree"; selectedIndex: number }
  | { kind: "agent"; agentId: string };

/** One turn of a conversation transcript. `"user"` turns are added client-side, immediately,
 * the moment the operator hits Enter — the server never echoes the operator's own messages
 * back over SSE, so this is the only place they're recorded (Round 6,
 * docs/handoffs/tui.md). `"assistant"` turns accumulate streamed `agent_output` chunks:
 * consecutive chunks with no intervening user turn append to the same turn's `text` rather
 * than starting a new one, so one streamed model response reads as a single turn. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
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
}

export type Action =
  | { type: "sse_event"; event: ServerSentEvent }
  | { type: "tree_response"; tree: AgentTreeNode[] }
  | { type: "command_error"; error: string }
  | { type: "key"; key: KeyEvent }
  | { type: "resize"; rows: number; cols: number }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "reconnected" }
  | { type: "tick"; now: number };

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
