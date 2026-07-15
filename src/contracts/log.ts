// ADR 0005. JSONL-per-agent logging. First line of each agent's file is a LogHeader;
// every subsequent line is a LogEvent. A tool reading only first lines across a session
// directory must be able to reconstruct the full agent tree and timeline.

// ADR 0005 amendment (2026-07-15, Fable/architect-on-call): `client` and `build` added to
// the header. Both are required on every newly-written header; readers of older log files
// (written before this amendment) must tolerate their absence — additive, backward-
// compatible-to-read schema change, not a header format version bump.

/** How the log-writing process was invoked, per ADR 0001's mode composition — a one-shot
 * fact captured at session start, not an attempt to track every remote client that connects
 * to a `--server` process over its lifetime. `"server"` describes the headless server
 * process itself; it does not (and cannot) name whichever remote client(s) later connect to
 * it — there is no single authoritative answer to "which client" for a long-lived server
 * process, so this deliberately doesn't attempt one. `"none"` is the standalone
 * `--instructions`/`--job` dark-factory path, which has no client at all. */
export type SessionClientKind = "tui" | "web" | "server" | "none";

/** Build identity stamped into the compiled binary at build time (scripts/build.ts). Fields
 * other than `version` are `null` for an unstamped build (running from source, or a raw
 * `bun build --compile` that bypassed the script). */
export interface BuildInfo {
  version: string;
  gitSha: string | null;
  dirty: boolean;
  releaseTag: string | null;
}

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
  client: SessionClientKind;
  build: BuildInfo;
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
