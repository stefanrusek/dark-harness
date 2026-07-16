// Pure rendering: TuiState -> an exact-height array of plain-text rows, plus a separate
// ANSI-formatting step. Kept pure (no process/stdout access) so it's fully unit-testable;
// app.ts is the only place that actually writes to a terminal.

import type { AgentStatus } from "../contracts/index.ts";
import { parseMarkdown, sanitizeText } from "../markdown/index.ts";
import { renderMarkdownRows } from "./markdown-ansi.ts";
import { flattenTree } from "./tree.ts";
import type { AgentInfo, TuiState, Turn } from "./types.ts";
import { wrapText } from "./width.ts";

export { wrapText } from "./width.ts";

const HEADER_ROWS = 2;

const RESET = "\x1b[0m";
const INVERSE = "\x1b[7m";
/** Synthetic cursor marker: an inverse-video space appended after the input text. The alt-
 * screen shell hides the real terminal cursor for the whole session (see app.ts), and this
 * module never touches the terminal directly, so the input box needs its own visible marker
 * rendered as part of the frame text — consistent with the existing pure
 * `TuiState -> string[]` rendering architecture, no real cursor-position math needed. Only
 * the root view's input line is editable, so only `renderRoot` uses this. */
export const CURSOR_MARKER = `${INVERSE} ${RESET}`;
const STATUS_COLOR: Record<AgentStatus, string> = {
  running: "\x1b[33m",
  waiting: "\x1b[36m",
  done: "\x1b[32m",
  failed: "\x1b[31m",
  // Round 13 (docs/handoffs/core.md): distinct from "failed" now that TaskStop reports a
  // dedicated "stopped" status. Same dimming as "done" (neutral outcome, not a fault) — TUI's
  // own domain call, revisit if Mary wants a different color.
  stopped: "\x1b[90m",
};

export function colorizeStatus(status: AgentStatus, text: string): string {
  return `${STATUS_COLOR[status]}${text}${RESET}`;
}

/** Format a non-negative millisecond duration as a short human-readable elapsed string
 * (`"0s"`, `"12s"`, `"1m05s"`, `"2h03m"`) — the liveness indicator shown per agent in the
 * tree/agent views (Round 5, docs/handoffs/tui.md). Negative input (a clock that hasn't
 * caught up to an event's timestamp yet) clamps to `"0s"` rather than showing a confusing
 * negative duration. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

/** Render a conversation transcript with real turn separation: each turn wrapped to `cols`,
 * a blank line between consecutive turns, and a role label (`"> "`, matching the input
 * prompt's own marker, so a user turn visually echoes what was typed) on user turns only.
 * Without this, turns read as one unbroken wall of concatenated text with no visual boundary
 * and no sign the user ever said anything (Round 6, docs/handoffs/tui.md).
 *
 * Assistant turns are rendered as Markdown (DH-0056): parsed via `parseMarkdown` (which
 * applies the defensive `sanitizeText` escape-stripping unconditionally as its own step
 * zero) and turned into styled, reset-terminated ANSI rows by `markdown-ansi.ts`'s safe SGR
 * allowlist — never a raw passthrough of model-authored bytes. User turns are the operator's
 * own echoed input, not Markdown, so they're only run through `sanitizeText` and wrapped as
 * plain text. */
export function renderTranscript(transcript: Turn[], cols: number): string[] {
  const lines: string[] = [];
  transcript.forEach((turn, index) => {
    if (index > 0) lines.push("");
    if (turn.role === "user") {
      lines.push(...wrapText(`> ${sanitizeText(turn.text)}`, cols));
    } else {
      lines.push(...renderMarkdownRows(parseMarkdown(turn.text), cols));
    }
  });
  return lines;
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
  // Shown right in the always-visible header, not just the per-view footer hint, so a
  // reconnect notice (DH-0024) can't be missed just because the operator is deep in the
  // tree/agent view when it fires.
  const reconnectSuffix = state.reconnectNotice ? `  ⚠ ${state.reconnectNotice}` : "";
  const totals = sessionTokenTotals(state);
  const totalsSuffix = `  —  ${formatTokenCost(totals.inputTokens, totals.outputTokens, totals.costUsd)}`;
  const title = `Dark Harness — ${viewLabel(state)} — ${state.connection}${totalsSuffix}${sessionSuffix}${reconnectSuffix}`;
  const separator = "─".repeat(Math.max(1, cols));
  return [title, separator];
}

function rootAgent(state: TuiState): AgentInfo | null {
  return state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;
}

/** Format a token/cost figure as `"12,345 tok"` (no cost known) or `"12,345 tok / $0.0456"`
 * (DH-0028) — shared by the per-agent and session-total displays so both read consistently. */
export function formatTokenCost(
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
): string {
  const totalTokens = inputTokens + outputTokens;
  const tokenPart = `${totalTokens.toLocaleString("en-US")} tok`;
  return costUsd === null ? tokenPart : `${tokenPart} / $${costUsd.toFixed(4)}`;
}

/** Session-wide token/cost totals summed across every currently-tracked agent (DH-0028) —
 * the operator's console-equivalent of Web's `sessionTotals`. `null` cost only if *no*
 * tracked agent has ever reported a cost figure (matching each agent's own "cost unknown"
 * semantics), otherwise sums whatever cost figures are known. */
export function sessionTokenTotals(state: TuiState): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = null;
  for (const agent of state.agents.values()) {
    inputTokens += agent.inputTokens;
    outputTokens += agent.outputTokens;
    if (agent.costUsd !== null) costUsd = (costUsd ?? 0) + agent.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}

function renderRoot(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; footer: string[] } {
  const agent = rootAgent(state);
  const content = agent
    ? tailLines(renderTranscript(agent.transcript, cols), contentRows)
    : tailLines(["Waiting for root agent to start…"], contentRows);
  const hint = state.statusMessage ?? "[Enter] send   [←] agent tree   [Ctrl+C] quit";
  // Cursor marker renders at `inputCursor`, not always at the end (DH-0026 added in-text
  // cursor movement). Embedded newlines from a bracketed-paste (DH-0026) are shown as a
  // visible "⏎" glyph on this one-line display only — the underlying `state.input` keeps the
  // real newline characters, which is what actually gets sent as the message.
  const before = state.input.slice(0, state.inputCursor).replace(/\n/g, "⏎");
  const after = state.input.slice(state.inputCursor).replace(/\n/g, "⏎");
  const inputLine = `> ${before}${CURSOR_MARKER}${after}`;
  return { content: padRows(content, contentRows), footer: [hint, inputLine] };
}

function renderTree(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; footer: string[] } {
  const flat = flattenTree(state.tree ?? []);
  const selectedIndex = state.view.kind === "tree" ? state.view.selectedIndex : -1;
  if (flat.length === 0) {
    return {
      content: padRows(["No agents yet."], contentRows),
      footer: [state.statusMessage ?? "[↑/↓] navigate   [Enter] open   [Esc] back"],
    };
  }
  const entryTexts = flat.map((entry, index) => {
    const marker = index === selectedIndex ? "> " : "  ";
    const indent = "  ".repeat(entry.depth);
    const glyph = colorizeStatus(entry.node.status, "●");
    // DH-0069: prefer the Agent tool's `description` — a human-readable label ("Fix flaky
    // retry test") instead of a raw agentId/UUID — falling back to the old `agentId (model)`
    // format only when it's absent (the root agent, which never has one, or a pre-DH-0069
    // session logged before description became required).
    const label = entry.node.description ?? `${entry.node.agentId} (${entry.node.model})`;
    const trackedAgent = state.agents.get(entry.node.agentId);
    const elapsed =
      trackedAgent === undefined
        ? ""
        : `  [${formatElapsed(state.now - trackedAgent.lastEventAt)}]`;
    const tokens =
      trackedAgent === undefined
        ? ""
        : `  ${formatTokenCost(trackedAgent.inputTokens, trackedAgent.outputTokens, trackedAgent.costUsd)}`;
    return `${marker}${indent}${glyph} ${label}${elapsed}${tokens}`;
  });
  // Wrap each entry independently (rather than the old approach of wrapping the whole
  // joined string) so the start line of every entry is known — needed to compute a
  // selection-following scroll window below (DH-0027).
  const entryLineRuns = entryTexts.map((text) => wrapText(text, cols));
  const allLines: string[] = [];
  const entryStartLine: number[] = [];
  for (const run of entryLineRuns) {
    entryStartLine.push(allLines.length);
    allLines.push(...run);
  }
  const maxScroll = Math.max(0, allLines.length - contentRows);
  const selectedStart = entryStartLine[selectedIndex] ?? 0;
  // Center the selection in the viewport rather than bottom-anchoring the whole tree
  // (the old `tailLines` behavior) — that anchoring let the highlighted entry scroll
  // off-screen entirely the moment the operator moved selection above the visible top,
  // with no indication of where it went. This is a pure function of `selectedIndex` alone,
  // so no extra "scroll position" state is needed — render.ts stays a pure `TuiState ->
  // string[]` function.
  const scrollTop = Math.min(maxScroll, Math.max(0, selectedStart - Math.floor(contentRows / 2)));
  const content = allLines.slice(scrollTop, scrollTop + contentRows);
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
    ? tailLines(renderTranscript(agent.transcript, cols), contentRows)
    : tailLines(["(no output yet)"], contentRows);
  const meta = agent
    ? `Model: ${agent.model}   Status: ${colorizeStatus(agent.status, agent.status)}` +
      ` (${formatElapsed(state.now - agent.statusSince)})` +
      `   Last event: ${formatElapsed(state.now - agent.lastEventAt)} ago` +
      `   ${formatTokenCost(agent.inputTokens, agent.outputTokens, agent.costUsd)}`
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
