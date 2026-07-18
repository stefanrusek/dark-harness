// DH-0037 (tracking/DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md), piece
// 2 of 2: the `dh logs <sessionDir>` analysis tool. HANDOFF.md §7 frames the JSONL
// header-line design as existing "so a tool reading only first lines across all files can
// reconstruct the complete timeline and agent tree" — no such tool shipped until now. Per-
// agent status/cost/duration additionally requires scanning each file's later lines (the
// header alone only carries spawn-time facts), so this reads full files, not just headers.
//
// Deliberately does NOT read/write `summary.json` — that's DH-0037's other user story,
// explicitly sequenced after DH-0050's Core round (see the ticket's owner note) so it can
// reuse that ticket's field shapes instead of inventing a parallel one.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentStatus, LogEvent, LogLine } from "../contracts/index.ts";
// DH-0104 (docs/design/style-guide.md §4): elapsed formatting is shared with the TUI/Web via
// `src/format.ts` — see `formatDuration` below for why `dh logs` doesn't keep its own
// elapsed exception (only cost does).
import { formatElapsed } from "../format.ts";

/** DH-0038: generalizes the same tolerant JSONL parsing `summarizeFile` below uses so
 * Core's `src/agent/resume.ts` (which needs full per-line event replay, not just a
 * status/cost/duration summary) can reuse it instead of duplicating the "skip
 * corrupt/truncated lines, don't fail the whole file" logic. Mirrors `SessionLogger.
 * filePathFor`'s percent-encoding (`../logger.ts`) so this reads exactly the file a real
 * `SessionLogger` for this `sessionDir` would have written for `agentId` — Server owns the
 * on-disk layout (DH-0038's design doc, D7), so that encoding lives here, not duplicated in
 * Core. Returns `[]` (not a throw) when the file doesn't exist at all — a missing
 * individual agent file (e.g. a sub-agent that was spawned but never got a chance to log
 * anything, or was pruned) is tolerated by every caller of this function, same policy as a
 * corrupt line within a file that does exist. */
export function readAgentLogLines(sessionDir: string, agentId: string): LogLine[] {
  const path = join(sessionDir, `${encodeURIComponent(agentId)}.jsonl`);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseJsonlContent(content);
}

export interface AgentLogSummary {
  agentId: string;
  parentAgentId: string | null;
  description?: string;
  model: string;
  spawnedAt: string;
  status: AgentStatus;
  /** Sum of every `token_usage` line's `costUsd` in this agent's file. Undefined if no
   * `token_usage` line in the file carried a cost (e.g. pricing wasn't configured). */
  costUsd?: number;
  /** Last event timestamp minus the header's `spawnedAt`, in ms. Undefined if the file has
   * no lines after the header (e.g. the agent never got past being spawned) or either
   * timestamp fails to parse. */
  durationMs?: number;
}

export interface AgentLogTreeNode extends AgentLogSummary {
  children: AgentLogTreeNode[];
}

function parseJsonlContent(content: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      lines.push(JSON.parse(trimmed) as LogLine);
    } catch {
      // A corrupt/truncated final line (e.g. the process died mid-write) shouldn't sink
      // analysis of the rest of this file, or of the session as a whole.
    }
  }
  return lines;
}

function parseJsonlFile(path: string): LogLine[] {
  return parseJsonlContent(readFileSync(path, "utf8"));
}

function summarizeFile(path: string): AgentLogSummary | undefined {
  const lines = parseJsonlFile(path);
  const header = lines[0];
  if (header === undefined || header.type !== "header") {
    // Not a valid agent log file (e.g. empty, or corrupted past recognition) — skip it
    // rather than fail the whole directory's analysis.
    return undefined;
  }

  let status: AgentStatus = "running";
  let costUsd: number | undefined;
  let lastTimestamp = header.spawnedAt;

  // Every line after the first (the header) is an ordinary event line — LogLine's own
  // definition guarantees exactly one header per file, always first.
  for (const line of lines.slice(1) as LogEvent[]) {
    lastTimestamp = line.timestamp;
    if (line.type === "status_change") {
      status = line.status;
    } else if (line.type === "completed") {
      status = "done";
    } else if (line.type === "failed") {
      status = "failed";
    } else if (line.type === "token_usage" && line.costUsd !== undefined) {
      costUsd = (costUsd ?? 0) + line.costUsd;
    }
  }

  const durationMs = Date.parse(lastTimestamp) - Date.parse(header.spawnedAt);

  return {
    agentId: header.agentId,
    parentAgentId: header.parentAgentId,
    ...(header.description !== undefined ? { description: header.description } : {}),
    model: header.model,
    spawnedAt: header.spawnedAt,
    status,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
  };
}

/** Reads every `*.jsonl` file directly inside `sessionDir` and summarizes each agent's
 * status/cost/duration. Returns flat summaries, in no particular order — pass the result to
 * `buildAgentLogTree` to nest them by `parentAgentId`. Throws only if `sessionDir` itself
 * can't be listed (doesn't exist, not a directory, permissions) — a malformed individual
 * file inside it is skipped, not fatal. */
export function readSessionLogSummaries(sessionDir: string): AgentLogSummary[] {
  let files: string[];
  try {
    files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  } catch (err) {
    throw new Error(`cannot read session log directory "${sessionDir}": ${(err as Error).message}`);
  }

  const summaries: AgentLogSummary[] = [];
  for (const file of files) {
    const summary = summarizeFile(join(sessionDir, file));
    if (summary !== undefined) summaries.push(summary);
  }
  return summaries;
}

/** Nests flat summaries into a forest by `parentAgentId`. An entry whose parent isn't in
 * this set (root agent, or a partial/truncated directory missing the parent's file) is
 * treated as a root too, so nothing silently disappears from the tree. */
export function buildAgentLogTree(summaries: AgentLogSummary[]): AgentLogTreeNode[] {
  const nodes = new Map<string, AgentLogTreeNode>(
    summaries.map((s) => [s.agentId, { ...s, children: [] }]),
  );
  const roots: AgentLogTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentAgentId !== null ? nodes.get(node.parentAgentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// DH-0104 (docs/design/style-guide.md §4): elapsed rendering is unified across every
// surface — including `dh logs` — via the shared `src/format.ts`'s `formatElapsed` (spaces +
// "just now" affordance). Elapsed has no glanceable/detail two-tier split (unlike cost and
// tokens), so `dh logs` doesn't get its own exception here the way it does for cost below.
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "?";
  return formatElapsed(ms);
}

/** DH-0067 fix: this used to return the literal string `$?` for an unpriced/unknown cost —
 * indistinguishable from an unexpanded shell variable in a paste of `dh logs` output ("cost
 * =$?" read as a shell-expansion bug, not a deliberate "unknown" marker). `—` (em dash) is
 * unambiguous prose for "no value available" and can't be mistaken for shell syntax.
 *
 * DH-0104: `dh logs` is a deliberate, documented 4-dp exception to the interactive surfaces'
 * 2-dp `formatCostUsd` rule (docs/design/style-guide.md §4) — an audit-dump context where an
 * operator may care about sub-cent differences the 2-dp interactive views round away. It
 * still shares the interactive rule's other half: unknown cost is `—`, never `$0.00`. */
function formatCost(costUsd: number | undefined): string {
  return costUsd === undefined ? "—" : `$${costUsd.toFixed(4)}`;
}

/** DH-0067: `dh logs` reads static JSONL files after the fact — it has no way to confirm a
 * process reporting "running" is actually still alive (crashed/killed sessions leave no
 * terminal status line behind, since nothing was left running to write one). Qualifying
 * every "running" status this tool prints (rather than trying to detect liveness, which
 * would need something outside the log files themselves) keeps the tool honest about that
 * limitation instead of asserting a fact it can't verify. */
function formatStatusLabel(status: AgentLogTreeNode["status"]): string {
  return status === "running" ? "running (no terminal event seen)" : status;
}

// DH-0100: canonical status color model (docs/design/style-guide.md §1/§2.3), matching
// src/tui/render.ts's STATUS_COLOR exactly so `dh logs` and the TUI agree.
const STATUS_COLOR: Record<AgentLogTreeNode["status"], string> = Object.freeze({
  running: "\x1b[34m",
  waiting: "\x1b[33m",
  done: "\x1b[32m",
  failed: "\x1b[31m",
  stopped: "\x1b[35m",
});
const RESET = "\x1b[0m";

function colorizeStatusLabel(status: AgentLogTreeNode["status"], color: boolean): string {
  const label = formatStatusLabel(status);
  return color ? `${STATUS_COLOR[status]}${label}${RESET}` : label;
}

function formatNode(
  node: AgentLogTreeNode,
  prefix: string,
  isLast: boolean,
  color: boolean,
): string[] {
  const connector = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
  const label =
    `${node.agentId}${node.description ? ` (${node.description})` : ""} ` +
    `[${colorizeStatusLabel(node.status, color)}] cost=${formatCost(node.costUsd)} duration=${formatDuration(node.durationMs)} model=${node.model}`;
  const lines = [`${prefix}${connector}${label}`];
  const childPrefix = prefix === "" ? "" : `${prefix}${isLast ? "   " : "│  "}`;
  node.children.forEach((child, i) => {
    lines.push(...formatNode(child, childPrefix, i === node.children.length - 1, color));
  });
  return lines;
}

export interface FormatSessionLogTreeOptions {
  /** DH-0067: colorize status words (same palette as the TUI's `colorizeStatus`) — the
   * caller (cli.ts) decides this from `process.stdout.isTTY` so a piped/redirected `dh logs`
   * stays plain-text (standard isatty gate; matches `dh doctor`'s PASS/FAIL colorization). */
  color?: boolean;
}

/** Prints the agent tree for a session directory — the `dh logs <sessionDir>` output
 * (DH-0037). Each line shows the agent id, optional description, status, cumulative cost,
 * duration, and model. */
export function formatSessionLogTree(
  sessionDir: string,
  options: FormatSessionLogTreeOptions = {},
): string {
  const summaries = readSessionLogSummaries(sessionDir);
  if (summaries.length === 0) {
    return `(no agent log files found in ${sessionDir})`;
  }
  const color = options.color ?? false;
  const roots = buildAgentLogTree(summaries);
  return roots.flatMap((root, i) => formatNode(root, "", i === roots.length - 1, color)).join("\n");
}

export interface SessionListEntry {
  sessionId: string;
  /** Earliest header `spawnedAt` across the session's agent files (the root agent's, in
   * practice) — undefined if no agent file in the directory parsed as a valid header. */
  startedAt?: string;
  agentCount: number;
}

/** DH-0067: `dh logs` with no argument used to just error, forcing the operator to `ls
 * .dh-logs` and copy a UUID by hand. Lists every session subdirectory under `logsRootDir`
 * (typically `./.dh-logs`), each with its earliest recorded start time and agent-file count,
 * newest-first — enough for an operator to pick the session they meant without leaving the
 * tool. Throws only if `logsRootDir` itself can't be listed; an individual session directory
 * that fails to summarize is skipped (agentCount 0), not fatal to the listing. */
export function listSessionDirectories(logsRootDir: string): SessionListEntry[] {
  let entries: string[];
  try {
    entries = readdirSync(logsRootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    throw new Error(`cannot read logs directory "${logsRootDir}": ${(err as Error).message}`);
  }

  const sessions: SessionListEntry[] = entries.map((sessionId) => {
    // `entries` was already filtered to directories by the `readdirSync` above, so this
    // only throws in a real race (the directory disappearing between listing and reading) —
    // not worth a defensive catch that would only ever hide that same rare race.
    const summaries = readSessionLogSummaries(join(logsRootDir, sessionId));
    const startedAt = summaries
      .map((s) => s.spawnedAt)
      .sort()
      .at(0);
    return {
      sessionId,
      ...(startedAt !== undefined ? { startedAt } : {}),
      agentCount: summaries.length,
    };
  });

  // Newest-first: undefined startedAt (unreadable/empty directory) sorts last.
  sessions.sort((a, b) => {
    if (a.startedAt === undefined && b.startedAt === undefined) return 0;
    if (a.startedAt === undefined) return 1;
    if (b.startedAt === undefined) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return sessions;
}

/** Formats `listSessionDirectories`' result as the `dh logs` (no-argument) output — one line
 * per session: id, start time (or `?`), agent count. */
export function formatSessionList(logsRootDir: string): string {
  const sessions = listSessionDirectories(logsRootDir);
  if (sessions.length === 0) {
    return `(no sessions found under ${logsRootDir})`;
  }
  const lines = sessions.map(
    (s) => `${s.sessionId}  started=${s.startedAt ?? "?"}  agents=${s.agentCount}`,
  );
  return lines.join("\n");
}
