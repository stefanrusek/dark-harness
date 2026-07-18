// ADR 0002. Client -> server commands, sent as HTTP POST bodies. Responses are ordinary
// HTTP responses (CommandAck or a command-specific payload), not paired to the SSE stream.

import type { AgentStatus } from "./log.type.ts";

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

// DH-0093: slash-command backend support (model switching, skill invocation). Additive to
// ClientCommand — see docs/adr/... escalation trigger rationale in CLAUDE.md §6 item 2; this
// round's design was already architect-signed (Fable) in the ticket itself.
export interface ListModelsCommand {
  type: "list_models";
}

export interface ModelInfo {
  name: string;
  provider: string;
  model: string; // provider-side id, display only
  isDefault: boolean;
  isActive: boolean;
}

export interface ListModelsResponse extends CommandAck {
  models: ModelInfo[];
}

export interface SwitchModelCommand {
  type: "switch_model";
  agentId: string; // v1: must be ROOT_AGENT_ID; anything else -> 400 ack
  model: string;
}

export interface ListSkillsCommand {
  type: "list_skills";
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface ListSkillsResponse extends CommandAck {
  skills: SkillInfo[];
}

export interface InvokeSkillCommand {
  type: "invoke_skill";
  agentId: string;
  skill: string;
  args?: string;
}

export type ClientCommand =
  | SendMessageCommand
  | RequestAgentTreeCommand
  | DownloadLogsCommand
  | StopAgentCommand
  | ListModelsCommand
  | SwitchModelCommand
  | ListSkillsCommand
  | InvokeSkillCommand;

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
