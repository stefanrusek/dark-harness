// ADR 0002. Client -> server commands, sent as HTTP POST bodies. Responses are ordinary
// HTTP responses (CommandAck or a command-specific payload), not paired to the SSE stream.

import type { AgentStatus } from "./log.ts";

export interface SendMessageCommand {
  type: "send_message";
  agentId: string;
  message: string;
}

export interface RequestAgentTreeCommand {
  type: "request_agent_tree";
}

export interface DownloadLogsCommand {
  type: "download_logs";
  /** Omit for the full session bundle. */
  agentId?: string;
}

export interface StopAgentCommand {
  type: "stop_agent";
  agentId: string;
}

export type ClientCommand =
  | SendMessageCommand
  | RequestAgentTreeCommand
  | DownloadLogsCommand
  | StopAgentCommand;

export interface CommandAck {
  ok: boolean;
  error?: string;
}

export interface AgentTreeNode {
  agentId: string;
  parentAgentId: string | null;
  model: string;
  // Round 13 (docs/handoffs/core.md): was previously a hand-duplicated literal union
  // ("running" | "waiting" | "done" | "failed") that would have silently missed TaskStop's
  // new "stopped" AgentStatus value. Now a direct reference so the two can never diverge.
  status: AgentStatus;
  /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label for this agent, from
   * the Agent tool's optional `description` param — lets TUI/Web's agent tree and any other
   * consumer show more than `agent-<id> model=<name>`. Undefined when the spawning call
   * omitted it. */
  description?: string;
  children: AgentTreeNode[];
}

export interface AgentTreeResponse extends CommandAck {
  tree: AgentTreeNode[];
}
