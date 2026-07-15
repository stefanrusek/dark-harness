// Pure rendering: TuiState -> an exact-height array of plain-text rows, plus a separate
// ANSI-formatting step. Kept pure (no process/stdout access) so it's fully unit-testable;
// app.ts is the only place that actually writes to a terminal.

import type { AgentStatus } from "../contracts/index.ts";
import { flattenTree } from "./tree.ts";
import type { AgentInfo, TuiState } from "./types.ts";

const HEADER_ROWS = 2;

const RESET = "\x1b[0m";
const STATUS_COLOR: Record<AgentStatus, string> = {
  running: "\x1b[33m",
  waiting: "\x1b[36m",
  done: "\x1b[32m",
  failed: "\x1b[31m",
};

export function colorizeStatus(status: AgentStatus, text: string): string {
  return `${STATUS_COLOR[status]}${text}${RESET}`;
}

/** Greedily wrap text to `cols`-wide lines, honoring existing newlines. */
export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, cols);
  const out: string[] = [];
  const sourceLines = text.split("\n");
  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      out.push("");
      continue;
    }
    for (let i = 0; i < sourceLine.length; i += width) {
      out.push(sourceLine.slice(i, i + width));
    }
  }
  return out;
}

/** Keep only the last `maxLines` entries, preserving order. */
export function tailLines(lines: string[], maxLines: number): string[] {
  const bound = Math.max(0, maxLines);
  return lines.length <= bound ? lines : lines.slice(lines.length - bound);
}

function padRows(rows: string[], count: number): string[] {
  const out = rows.slice(0, count);
  while (out.length < count) out.push("");
  return out;
}

function viewLabel(state: TuiState): string {
  switch (state.view.kind) {
    case "root":
      return "Root Agent";
    case "tree":
      return "Agent Tree";
    case "agent":
      return `Agent ${state.view.agentId}`;
  }
}

function headerRows(state: TuiState, cols: number): string[] {
  const sessionSuffix = state.sessionEnded
    ? `  session ended (exit ${state.sessionEnded.exitCode})`
    : "";
  const title = `Dark Harness — ${viewLabel(state)} — ${state.connection}${sessionSuffix}`;
  const separator = "─".repeat(Math.max(1, cols));
  return [title, separator];
}

function rootAgent(state: TuiState): AgentInfo | null {
  return state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;
}

function renderRoot(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; footer: string[] } {
  const agent = rootAgent(state);
  const content = agent
    ? tailLines(wrapText(agent.output, cols), contentRows)
    : tailLines(["Waiting for root agent to start…"], contentRows);
  const hint = state.statusMessage ?? "[Enter] send   [←] agent tree   [Ctrl+C] quit";
  const inputLine = `> ${state.input}`;
  return { content: padRows(content, contentRows), footer: [hint, inputLine] };
}

function renderTree(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; footer: string[] } {
  const flat = flattenTree(state.tree ?? []);
  const selectedIndex = state.view.kind === "tree" ? state.view.selectedIndex : -1;
  const lines =
    flat.length === 0
      ? ["No agents yet."]
      : flat.map((entry, index) => {
          const marker = index === selectedIndex ? "> " : "  ";
          const indent = "  ".repeat(entry.depth);
          const glyph = colorizeStatus(entry.node.status, "●");
          const label = `${entry.node.agentId} (${entry.node.model})`;
          return `${marker}${indent}${glyph} ${label}`;
        });
  const content = tailLines(wrapText(lines.join("\n"), cols), contentRows);
  const hint = state.statusMessage ?? "[↑/↓] navigate   [Enter] open   [Esc] back";
  return { content: padRows(content, contentRows), footer: [hint] };
}

function renderAgent(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; footer: string[] } {
  if (state.view.kind !== "agent") return { content: padRows([], contentRows), footer: [""] };
  const agent = state.agents.get(state.view.agentId) ?? null;
  const content = agent
    ? tailLines(wrapText(agent.output, cols), contentRows)
    : tailLines(["(no output yet)"], contentRows);
  const meta = agent
    ? `Model: ${agent.model}   Status: ${colorizeStatus(agent.status, agent.status)}`
    : "Model: (unknown)";
  const hint = state.statusMessage ?? `${meta}   —   [Esc] back to root (read-only)`;
  return { content: padRows(content, contentRows), footer: [hint] };
}

/** Render the full frame as an exact-height array of plain rows (no leading/trailing ANSI). */
export function renderFrame(state: TuiState): string[] {
  const { rows, cols } = state.size;
  const header = headerRows(state, cols);
  const footerRows = state.view.kind === "root" ? 2 : 1;
  const contentRows = Math.max(0, rows - HEADER_ROWS - footerRows);

  const { content, footer } =
    state.view.kind === "root"
      ? renderRoot(state, contentRows, cols)
      : state.view.kind === "tree"
        ? renderTree(state, contentRows, cols)
        : renderAgent(state, contentRows, cols);

  const frame = [...header, ...content, ...footer];
  return padRows(frame, rows);
}

/** Turn plain rows into a full-redraw ANSI frame: cursor home, each row followed by
 * clear-to-end-of-line, then clear-to-end-of-screen so a shorter frame doesn't leave
 * stale characters from a taller previous one. */
export function frameToAnsi(rows: string[]): string {
  const body = rows.map((row) => `${row}\x1b[K`).join("\n");
  return `\x1b[H${body}\x1b[J`;
}
