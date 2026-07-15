// ADR 0002. Client -> server commands, sent as HTTP POST bodies. Responses are ordinary
// HTTP responses (CommandAck or a command-specific payload), not paired to the SSE stream.

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
  status: "running" | "waiting" | "done" | "failed";
  children: AgentTreeNode[];
}

export interface AgentTreeResponse extends CommandAck {
  tree: AgentTreeNode[];
}
