// Test double standing in for Core's real agent loop (docs/handoffs/server.md: "build
// against a minimal fake agent-loop interface"). Used by this domain's own tests, and
// exported for other domains (TUI/Web/E2E) that want a lightweight fixture to develop
// against before Core's real src/agent/loop.ts lands. Not production code.

import type { AgentTreeNode, LogLine, ServerSentEvent } from "../contracts/index.ts";
import type {
  AgentLoopEventListener,
  AgentLoopHandle,
  AgentLoopLogListener,
} from "./agent-loop.ts";

export class FakeAgentLoop implements AgentLoopHandle {
  private readonly eventListeners = new Set<AgentLoopEventListener>();
  private readonly logListeners = new Set<AgentLoopLogListener>();
  private tree: AgentTreeNode[] = [];
  readonly sentMessages: Array<{ agentId: string; message: string }> = [];
  readonly stoppedAgents: string[] = [];

  // An explicit (even empty) constructor is required for Bun's coverage instrumentation to
  // count the class's synthetic constructor slot as "hit" — see docs/handoffs/server.md
  // status log for detail.
  // biome-ignore lint/complexity/noUselessConstructor: see comment above
  constructor() {}

  onEvent(listener: AgentLoopEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onLog(listener: AgentLoopLogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  sendMessage(agentId: string, message: string): void {
    this.sentMessages.push({ agentId, message });
  }

  stopAgent(agentId: string): void {
    this.stoppedAgents.push(agentId);
  }

  getAgentTree(): AgentTreeNode[] {
    return this.tree;
  }

  /** Test setup: install the tree snapshot getAgentTree()/commands should see. */
  setAgentTree(tree: AgentTreeNode[]): void {
    this.tree = tree;
  }

  /** Test drive: push an event to every current onEvent subscriber. */
  emitEvent(event: ServerSentEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  /** Test drive: push a log line to every current onLog subscriber. */
  emitLog(agentId: string, line: LogLine): void {
    for (const listener of this.logListeners) listener(agentId, line);
  }
}
