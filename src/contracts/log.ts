// ADR 0005. JSONL-per-agent logging. First line of each agent's file is a LogHeader;
// every subsequent line is a LogEvent. A tool reading only first lines across a session
// directory must be able to reconstruct the full agent tree and timeline.

// ADR 0005 amendment (2026-07-15, Fable/architect-on-call): `client` and `build` added to
// the header. Both are required on every newly-written header; readers of older log files
// (written before this amendment) must tolerate their absence — additive, backward-
// compatible-to-read schema change, not a header format version bump.

import type { ReportedOutcome } from "./outcome.ts";

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
  /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label from the Agent tool's
   * optional `description` param. Undefined for the root agent (no spawning call to supply
   * one) and for any sub-agent spawned without it — readers must tolerate its absence exactly
   * like any other optional header field. */
  description?: string;
  /** DH-0038 (tracking/DH-0038-no-crash-recovery-or-session-resume.md), architect-signed
   * additive header field: present iff this agent's conversation was reconstructed via
   * `--resume <sessionId>` — names the session directory it continued from. Only ever set
   * on a root agent's header (resume is root-only in v1 — see `src/agent/resume.ts`'s doc
   * comment); absent on every sub-agent header, every non-resumed root, and every header
   * written before this field existed. Additive/optional — readers tolerate absence exactly
   * like `description`, no header version bump. */
  resumedFrom?: { sessionId: string };
}

export interface LogEventBase {
  version: 1;
  timestamp: string;
}

export interface LogMessageEvent extends LogEventBase {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
  /** DH-0044: set true only when this line records a mid-turn error/stop's *partial*
   * accumulated text (streamed to clients live but the turn never completed normally) —
   * absent on every complete turn and on every line written before this field existed.
   * Additive/optional; readers must tolerate its absence exactly like `costUsd`/
   * `cacheReadTokens` elsewhere in this file. */
  partial?: true;
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
  /** Round 10: mirrors the SSE `token_usage` event's `costUsd` (see loop.ts's
   * computeCostUsd()) so the durable JSONL log — not just the ephemeral live stream — carries
   * cost, since the log is the only after-the-fact diagnostic record (ADR 0005/HANDOFF.md
   * §7). Undefined when pricing wasn't configured for the model, same as the SSE side. */
  costUsd?: number;
}

// Round 13 (docs/handoffs/core.md): "stopped" is a distinct terminal status from "failed" —
// a deliberately TaskStop-ped task/agent is not the same diagnostic signal as a genuine
// failure, and JSONL post-analysis needs to tell them apart. Architect (Fable) sign-off
// already given in the conformance audit that introduced this round; see task-stop.ts.
export type AgentStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export interface LogStatusChangeEvent extends LogEventBase {
  type: "status_change";
  status: AgentStatus;
  /** DH-0017: optional human-readable reason, populated for a "stopped" transition (why it was
   * stopped) so a JSONL reader can tell a deliberate TaskStop from any other status change
   * without guessing from context. Additive/optional — absent on every status_change written
   * before this fix, and on every non-"stopped" transition, which need no reason. */
  reason?: string;
}

export interface LogCompletedEvent extends LogEventBase {
  type: "completed";
  success: true;
  /** DH-0050: present iff the model self-reported via the `ReportOutcome` tool (see
   * src/contracts/outcome.ts) — absent for a clean no-tool-call end (the pre-existing,
   * still-supported fallback), and on every line written before this field existed.
   * Additive/optional, same tolerance contract as every other optional field in this file. */
  outcome?: ReportedOutcome;
}

export interface LogFailedEvent extends LogEventBase {
  type: "failed";
  /** DH-0050: gains the value `"model reported failure via ReportOutcome"` alongside the
   * pre-existing `"model reported TASK_FAILED"`/`"response truncated at max_tokens..."`/
   * `"exceeded max turns..."` reasons — still a plain string, no union added, so no reader
   * needs updating to keep compiling. */
  reason: string;
  /** DH-0050: see {@link LogCompletedEvent.outcome} — present iff the model self-reported
   * failure via `ReportOutcome`. */
  outcome?: ReportedOutcome;
}

/** DH-0093: durable record of a mid-session model switch (`switch_model` command taking
 * effect) — the JSONL counterpart to the SSE `ModelSwitchedEvent` (src/contracts/events.ts).
 * The header's own `model` field stays the spawn-time value (headers are immutable, see this
 * file's own header comment); replaying a session's true model over time means the header
 * model folded with every `model_switched` line in order. */
export interface LogModelSwitchedEvent extends LogEventBase {
  type: "model_switched";
  from: string;
  to: string;
}

/** DH-0045 (tracking/DH-0045-no-extended-thinking-support.md §6): durable record of
 * extended-thinking content. Not a `message` role — reasoning is not part of the message
 * record. Ciphertext (`redacted_thinking` blocks) is never logged; `content` is empty when
 * `redacted` is true. */
export interface LogThinkingEvent extends LogEventBase {
  type: "thinking";
  /** Thinking text; empty string when redacted. Ciphertext is never logged. */
  content: string;
  redacted: boolean;
}

export type LogEvent =
  | LogMessageEvent
  | LogToolCallEvent
  | LogToolResultEvent
  | LogTokenUsageEvent
  | LogStatusChangeEvent
  | LogCompletedEvent
  | LogFailedEvent
  | LogModelSwitchedEvent
  | LogThinkingEvent;

/** The union of every line type that can appear in an agent's JSONL file. */
export type LogLine = LogHeader | LogEvent;
