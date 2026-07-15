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

export type Effect = { type: "send_command"; command: ClientCommand } | { type: "quit" };

export interface ReducerResult {
  state: TuiState;
  effects: Effect[];
}
