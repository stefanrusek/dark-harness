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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentStatus, LogEvent, LogLine } from "../contracts/index.ts";

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

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number | undefined): string {
  return costUsd === undefined ? "$?" : `$${costUsd.toFixed(4)}`;
}

function formatNode(node: AgentLogTreeNode, prefix: string, isLast: boolean): string[] {
  const connector = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
  const label =
    `${node.agentId}${node.description ? ` (${node.description})` : ""} ` +
    `[${node.status}] cost=${formatCost(node.costUsd)} duration=${formatDuration(node.durationMs)} model=${node.model}`;
  const lines = [`${prefix}${connector}${label}`];
  const childPrefix = prefix === "" ? "" : `${prefix}${isLast ? "   " : "│  "}`;
  node.children.forEach((child, i) => {
    lines.push(...formatNode(child, childPrefix, i === node.children.length - 1));
  });
  return lines;
}

/** Prints the agent tree for a session directory — the `dh logs <sessionDir>` output
 * (DH-0037). Each line shows the agent id, optional description, status, cumulative cost,
 * duration, and model. */
export function formatSessionLogTree(sessionDir: string): string {
  const summaries = readSessionLogSummaries(sessionDir);
  if (summaries.length === 0) {
    return `(no agent log files found in ${sessionDir})`;
  }
  const roots = buildAgentLogTree(summaries);
  return roots.flatMap((root, i) => formatNode(root, "", i === roots.length - 1)).join("\n");
}
