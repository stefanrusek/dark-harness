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

export interface AgentInfo {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  status: AgentStatus;
  output: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface TuiState {
  view: ViewState;
  agents: Map<string, AgentInfo>;
  /** Creation order of agents, for a stable fallback ordering before a tree is fetched. */
  agentOrder: string[];
  rootAgentId: string | null;
  tree: AgentTreeNode[] | null;
  input: string;
  connection: ConnectionStatus;
  sessionEnded: { exitCode: number } | null;
  size: { rows: number; cols: number };
  statusMessage: string | null;
}

export type Action =
  | { type: "sse_event"; event: ServerSentEvent }
  | { type: "tree_response"; tree: AgentTreeNode[] }
  | { type: "command_error"; error: string }
  | { type: "key"; key: KeyEvent }
  | { type: "resize"; rows: number; cols: number }
  | { type: "connection"; status: ConnectionStatus };

export type Effect = { type: "send_command"; command: ClientCommand } | { type: "quit" };

export interface ReducerResult {
  state: TuiState;
  effects: Effect[];
}
