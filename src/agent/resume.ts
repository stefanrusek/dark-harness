// DH-0038 (tracking/DH-0038-no-crash-recovery-or-session-resume.md): `--resume <sessionId>`
// crash-recovery mechanism. This module is the replay half — a pure(-ish, filesystem-reading)
// fold of an agent's durable JSONL event stream (ADR 0004/0005) back into an equivalent
// `ProviderMessage[]` history, per the architect (Fable) design's D1/D6/D7.
//
// DH-0003: `replayAgentHistory()` is the shared primitive — open one agent's JSONL log, fold
// its events into `ProviderMessage[]`. `loadResumeSession()` (root-only, `--resume`) calls it
// once per hop of a `resumedFrom` chain and concatenates; `reconstructSubAgentHistory()`
// (SendMessage's finished-sub-agent-resume path) calls it once, no chain walk — a sub-agent's
// log never has a `resumedFrom` header, it isn't its own session.
//
// This module never writes anything and never touches config/providers — it only reads an
// existing `.dh-logs/<sessionId>` directory tree and returns data; src/cli.ts is responsible
// for turning `ResumeResult` into a running `AgentRuntime` (see AgentRuntimeOptions.resume),
// and src/agent/runtime.ts is responsible for turning `reconstructSubAgentHistory()`'s result
// into a resumed sub-agent spawn (see AgentRuntime.sendMessage()).

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LogEvent, LogHeader, LogLine } from "../contracts/index.ts";
import {
  type AgentLogSummary,
  readAgentLogLines,
  readSessionLogSummaries,
} from "../server/index.ts";
import type { ProviderContentBlock, ProviderMessage } from "./providers/types.ts";
import { ROOT_AGENT_ID } from "./runtime.ts";

/** A chain of more than this many resumed-from hops is treated as corrupt (D6) — real usage
 * is expected to be a handful of hops at most; this is a sanity backstop against a cycle that
 * somehow evaded the `seen` check below (it shouldn't be able to), not a real limit anyone
 * should hit. */
const MAX_CHAIN_LENGTH = 100;

export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeError";
  }
}

export interface ResumeResult {
  /** Replayed conversation history, oldest → newest across the whole `resumedFrom` chain
   * (D1's "Resume chains" — a session resumed more than once). Does NOT include the new
   * wake-up message; the caller (src/cli.ts, via loop.ts's trailing-role merge) appends
   * that. */
  messages: ProviderMessage[];
  /** The root header's `model` alias from the directly-requested session (the last hop in
   * the chain) — resolved against the *current* config by the caller (D3: unresolvable is a
   * clean error, never a silent fallback). */
  model: string;
  /** The session id actually passed to `--resume` (the newest hop) — what the new header's
   * `resumedFrom.sessionId` names, and what the resume notice should say "continued from". */
  resumedFromSessionId: string;
  /** Sub-agent/task summaries from the directly-requested session's directory whose status
   * was still non-terminal (`running`/`waiting`) at crash time — D3's "list lost in-flight
   * sub-agents" for the resume notice. Only the last hop is inspected: an earlier hop in the
   * chain was itself already resumed once, so anything left non-terminal there was already
   * surfaced (or superseded) by that earlier resume. */
  lostAgents: AgentLogSummary[];
}

interface ChainHop {
  sessionId: string;
  header: LogHeader;
  events: LogEvent[];
}

function loadHop(logsRoot: string, sessionId: string, agentId: string): ChainHop {
  const dir = join(logsRoot, sessionId);
  if (!existsSync(dir)) {
    throw new ResumeError(`session directory not found: ${dir}`);
  }
  const lines: LogLine[] = readAgentLogLines(dir, agentId);
  const header = lines[0];
  if (header === undefined || header.type !== "header") {
    throw new ResumeError(
      `not a valid dh session directory (missing or headerless "${agentId}" log): ${dir}`,
    );
  }
  if (header.version !== 1) {
    throw new ResumeError(
      `session "${sessionId}" was written by an unsupported log format (header version ` +
        `${header.version}) — likely written by a newer dh than this one.`,
    );
  }
  if (header.sessionId !== sessionId) {
    throw new ResumeError(
      `session directory "${dir}" is inconsistent: it holds header sessionId ` +
        `"${header.sessionId}", not the requested "${sessionId}" (renamed or copied directory?).`,
    );
  }
  return { sessionId, header, events: lines.slice(1) as LogEvent[] };
}

/** Walks the `resumedFrom` header chain from the requested (newest) session back to its
 * oldest ancestor, then returns hops oldest → newest (replay order). Detects cycles and caps
 * chain length per D6. */
function resolveChain(logsRoot: string, sessionId: string): ChainHop[] {
  const hops: ChainHop[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = sessionId;

  while (currentId !== undefined) {
    if (seen.has(currentId)) {
      throw new ResumeError(
        `resume chain is cyclic: session "${currentId}" appears more than once in its own resumedFrom history.`,
      );
    }
    if (hops.length >= MAX_CHAIN_LENGTH) {
      throw new ResumeError(
        `resume chain exceeds ${MAX_CHAIN_LENGTH} hops — treating as corrupt rather than following it further.`,
      );
    }
    seen.add(currentId);

    let hop: ChainHop;
    try {
      hop = loadHop(logsRoot, currentId, ROOT_AGENT_ID);
    } catch (err) {
      if (currentId === sessionId || !(err instanceof ResumeError)) throw err;
      // An ancestor in the chain is missing/invalid (e.g. pruned by retention, DH-0037) —
      // name the broken link specifically rather than reporting the top-level id as the
      // problem, per D6's "Broken resume chain" failure mode.
      throw new ResumeError(
        `resume chain for "${sessionId}" is broken: ancestor session "${currentId}" ` +
          `(${(err as Error).message}) — it may have been pruned.`,
      );
    }
    hops.push(hop);
    currentId = hop.header.resumedFrom?.sessionId;
  }

  hops.reverse();
  return hops;
}

/** Stringifies a `LogToolResultEvent.output` for replay — logged as `unknown` but always a
 * string in practice (D1: `runToolCalls` in loop.ts logs the same `output: string` it puts
 * in the provider block). Defensive fallback for anything else. */
function stringifyToolOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

/** D1's fold: replays one hop's (or the whole chain's concatenated) event lines into
 * `ProviderMessage[]`, tolerant of skipped/corrupt lines exactly like `readAgentLogLines`
 * already is, with dangling-`tool_use` repair applied once at the very end. */
function foldEventsToMessages(events: LogEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  let openAssistant: ProviderMessage | undefined;
  let pendingResults: ProviderContentBlock[] = [];
  const outstandingToolUseIds = new Set<string>();

  const flushAssistant = () => {
    if (openAssistant) {
      messages.push(openAssistant);
      openAssistant = undefined;
    }
  };
  const flushResults = () => {
    if (pendingResults.length > 0) {
      messages.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };

  for (const event of events) {
    switch (event.type) {
      case "message": {
        if (event.role === "system") continue; // D1: system-role lines are log annotations, never replayed.
        flushResults();
        flushAssistant();
        if (event.role === "user") {
          messages.push({ role: "user", content: [{ type: "text", text: event.content }] });
        } else {
          openAssistant = { role: "assistant", content: [{ type: "text", text: event.content }] };
        }
        break;
      }
      case "tool_call": {
        if (!openAssistant) {
          // D1: an assistant turn with tool calls but zero text emits no `message` event —
          // tool_call must be able to open the assistant message itself.
          openAssistant = { role: "assistant", content: [] };
        }
        openAssistant.content.push({
          type: "tool_use",
          id: event.toolUseId,
          name: event.toolName,
          input: event.input,
        });
        outstandingToolUseIds.add(event.toolUseId);
        break;
      }
      case "tool_result": {
        // The assistant turn that made this call is done as soon as its first result lands.
        flushAssistant();
        outstandingToolUseIds.delete(event.toolUseId);
        pendingResults.push({
          type: "tool_result",
          toolUseId: event.toolUseId,
          content: stringifyToolOutput(event.output),
          isError: event.isError,
        });
        break;
      }
      default:
        // token_usage, status_change, completed, failed — not conversation content (D1).
        break;
    }
  }

  flushAssistant();

  // D1's dangling-tool_use repair: any tool_use that never got a matching tool_result (crash
  // mid-tool-execution) gets a synthesized error result, appended to the trailing user message.
  for (const toolUseId of outstandingToolUseIds) {
    pendingResults.push({
      type: "tool_result",
      toolUseId,
      content:
        "[dh: interrupted — the harness restarted before this tool call completed; its " +
        "outcome is unknown]",
      isError: true,
    });
  }
  flushResults();

  return messages;
}

/** DH-0003: the shared reconstruction primitive — opens one agent's JSONL log within one
 * session directory and folds it into `ProviderMessage[]`. The one place that turns a JSONL
 * log back into replayable history; both `loadResumeSession()` (root, chain-walking) and
 * `reconstructSubAgentHistory()` (sub-agent, single-hop) bottom out here rather than each
 * hand-rolling the file-open/header-validate/fold sequence. Throws `ResumeError` for every
 * failure mode `loadHop` itself enumerates (missing directory, headerless/malformed log,
 * unsupported version, sessionId mismatch). */
export function replayAgentHistory(
  logsRoot: string,
  sessionId: string,
  agentId: string,
): { header: LogHeader; messages: ProviderMessage[] } {
  const hop = loadHop(logsRoot, sessionId, agentId);
  return { header: hop.header, messages: foldEventsToMessages(hop.events) };
}

/**
 * Loads and replays the full `--resume <sessionId>` history: walks the `resumedFrom` chain
 * (D1), replays every hop's root-agent log via `replayAgentHistory()` and concatenates
 * (oldest → newest), and gathers the metadata (`model` alias, lost sub-agents) the caller
 * needs to build the resume notice and construct a resumed `AgentRuntime`. Synchronous
 * (matches every other filesystem read in this codepath — `SessionLogger`, `log-analysis.ts`
 * — none of it is async).
 *
 * Throws `ResumeError` for every failure mode enumerated in D6; callers (`src/cli.ts`) are
 * expected to catch it and route through the standard `dh: cannot resume session "<id>": ...`
 * `fail()` path, never letting it propagate as a crash.
 */
export function loadResumeSession(logsRoot: string, sessionId: string): ResumeResult {
  const hops = resolveChain(logsRoot, sessionId);

  const messages = hops.flatMap(
    (hop) => replayAgentHistory(logsRoot, hop.sessionId, ROOT_AGENT_ID).messages,
  );

  // resolveChain() always returns at least one hop (the requested session itself) or throws
  // — never an empty array, so this can't actually be undefined.
  const lastHop = hops.at(-1) as ChainHop;
  const lastHopDir = join(logsRoot, lastHop.sessionId);
  const lostAgents = readSessionLogSummaries(lastHopDir).filter(
    (summary) =>
      summary.agentId !== ROOT_AGENT_ID &&
      (summary.status === "running" || summary.status === "waiting"),
  );

  return {
    messages,
    model: lastHop.header.model,
    resumedFromSessionId: lastHop.sessionId,
    lostAgents,
  };
}

/** DH-0003: `SendMessage`'s finished-sub-agent-resume path — reconstructs one sub-agent's
 * conversation history from its JSONL log in the *current* session directory, no chain walk
 * (a sub-agent's log never carries a `resumedFrom` header; it isn't its own session — see
 * this module's doc comment). `failed`/`stopped` sub-agents resume identically to `done` ones
 * — the same treatment `--resume` itself already gives crash-terminal vs. clean-terminal
 * sessions (D6 only cares about chain integrity, never how the prior run ended); a `failed`
 * status is already visible to the resumed agent in the replayed history itself (a
 * `failed`-status log line, or a tool_result with `isError: true`). Throws `ResumeError` on
 * the same failure modes as `replayAgentHistory()`/`loadHop()`. */
export function reconstructSubAgentHistory(
  logsRoot: string,
  sessionId: string,
  agentId: string,
): ProviderMessage[] {
  return replayAgentHistory(logsRoot, sessionId, agentId).messages;
}
