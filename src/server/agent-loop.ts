// Cross-domain integration point (see docs/handoffs/server.md "Context"): Core's real
// src/agent/loop.ts does not exist yet. This interface is Server's own definition of the
// minimal shape it needs from the agent loop — an event-emitter-like handle exposing two
// independent output streams (live SSE-shaped events, and richer JSONL log lines per
// agent) plus the handful of control operations the four ClientCommand types need.
//
// When Core lands, reconcile: either Core's loop implements this interface directly, or a
// thin adapter in src/cli.ts bridges Core's actual shape to this one. Flagged explicitly in
// docs/handoffs/server.md's status log as the integration point to verify.

import type {
  AgentTreeNode,
  LogLine,
  ModelInfo,
  ServerSentEvent,
  SkillInfo,
} from "../contracts/index.ts";

export type AgentLoopEventListener = (event: ServerSentEvent) => void;
export type AgentLoopLogListener = (agentId: string, line: LogLine) => void;
export type Unsubscribe = () => void;

export interface AgentLoopHandle {
  /** Subscribe to every SSE-shaped event the loop emits, across all agents. */
  onEvent(listener: AgentLoopEventListener): Unsubscribe;
  /** Subscribe to every JSONL log line the loop emits, across all agents. */
  onLog(listener: AgentLoopLogListener): Unsubscribe;
  /** Send a user message into a running agent's conversation (send_message command). */
  sendMessage(agentId: string, message: string): void;
  /** Request a stop of the given agent (stop_agent command). */
  stopAgent(agentId: string): void;
  /** Current snapshot of the agent tree (request_agent_tree command). */
  getAgentTree(): AgentTreeNode[];
  /** DH-0093: the configured model catalog, wire-shaped (list_models command). */
  listModels(): ModelInfo[];
  /** DH-0093: switches the given agent's active model (switch_model command). v1 is
   * root-only — implementations should reject/throw for any other agentId; Server's own
   * handler (src/server/commands.ts) is responsible for translating that into a 400 ack. */
  switchModel(agentId: string, model: string): void;
  /** DH-0093: the currently-known skill catalog, wire-shaped (list_skills command). */
  listSkills(): SkillInfo[];
  /** DH-0093: composes and delivers a `/skillname [args]` invocation into the given agent's
   * conversation (invoke_skill command). May reject/throw for an unknown skill name; Server's
   * own handler is responsible for translating that into a 404 ack. */
  invokeSkill(agentId: string, skill: string, args: string | undefined): void | Promise<void>;
}
