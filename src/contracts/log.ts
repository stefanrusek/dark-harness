// ADR 0005. JSONL-per-agent logging. First line of each agent's file is a LogHeader;
// every subsequent line is a LogEvent. A tool reading only first lines across a session
// directory must be able to reconstruct the full agent tree and timeline.

export interface LogHeader {
  type: "header";
  version: 1;
  sessionId: string;
  agentId: string;
  /** null for the root agent. */
  parentAgentId: string | null;
  spawnedAt: string;
  model: string;
  instructionsSummary: string;
}

export interface LogEventBase {
  version: 1;
  timestamp: string;
}

export interface LogMessageEvent extends LogEventBase {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LogToolCallEvent extends LogEventBase {
  type: "tool_call";
  toolName: string;
  toolUseId: string;
  input: unknown;
}

export interface LogToolResultEvent extends LogEventBase {
  type: "tool_result";
  toolUseId: string;
  output: unknown;
  isError: boolean;
}

export interface LogTokenUsageEvent extends LogEventBase {
  type: "token_usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type AgentStatus = "running" | "waiting" | "done" | "failed";

export interface LogStatusChangeEvent extends LogEventBase {
  type: "status_change";
  status: AgentStatus;
}

export interface LogCompletedEvent extends LogEventBase {
  type: "completed";
  success: true;
}

export interface LogFailedEvent extends LogEventBase {
  type: "failed";
  reason: string;
}

export type LogEvent =
  | LogMessageEvent
  | LogToolCallEvent
  | LogToolResultEvent
  | LogTokenUsageEvent
  | LogStatusChangeEvent
  | LogCompletedEvent
  | LogFailedEvent;

/** The union of every line type that can appear in an agent's JSONL file. */
export type LogLine = LogHeader | LogEvent;
