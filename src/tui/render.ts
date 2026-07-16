// Pure rendering: TuiState -> an exact-height array of plain-text rows, plus a separate
// ANSI-formatting step. Kept pure (no process/stdout access) so it's fully unit-testable;
// app.ts is the only place that actually writes to a terminal.

import type { AgentStatus } from "../contracts/index.ts";
import { parseMarkdown, sanitizeText } from "../markdown/index.ts";
import { renderMarkdownRows } from "./markdown-ansi.ts";
import { flattenTree } from "./tree.ts";
import type { AgentInfo, ConnectionStatus, TuiState, Turn } from "./types.ts";
import { wrapText } from "./width.ts";

export { wrapText } from "./width.ts";

const HEADER_ROWS = 2;

// DH-0095: DH-0065's "chrome" pass (see `STATUS_COLOR`/`CONNECTION_COLOR` comments below)
// only ever touched color/bold/dim styling — it never added a left/right margin, so content
// was (and, per a live-binary screenshot, still is) flush against column 0 and the
// terminal's right edge with zero buffer. This is the fix: every rendered row gets a fixed
// `MARGIN`-wide space prefix, and every width-aware computation (wrapping, separators, tree-
// view scrolling) is sized against `cols - 2 * MARGIN` rather than the raw terminal width, so
// text never reaches either edge. Applied once, uniformly, in `renderFrame` (via
// `applyMargin`) rather than scattered per-view so no view can accidentally skip it.
const MARGIN = 1;

/** Prefix a single already-composed row with the left margin. Only the left side needs an
 * actual character: the row itself is wrapped to `cols - 2 * MARGIN` columns (see `MARGIN`'s
 * doc comment above), so it's already short enough to leave a right-edge gap without any
 * trailing padding — and `frameToAnsi`'s clear-to-end-of-line erases anything past it. */
function applyMargin(row: string): string {
  // An empty row (a blank transcript separator, or padRows' bottom-fill) stays empty rather
  // than becoming a bare margin of trailing whitespace — there's no content to indent, and
  // callers that detect "blank separator line" via `row === ""` (renderTranscript's own
  // turn-separator convention) still work unmodified.
  return row === "" ? "" : `${" ".repeat(MARGIN)}${row}`;
}

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

// DH-0065: chrome styling — header/footer/heading had "zero deliberate styling choices"
// per the review. Kept deliberately minimal (bold app name, colored connection pill, dim
// secondary info) rather than decorative; every code used here (1 bold, 2 dim, 32/33/31/90
// colors) is already emitted elsewhere in this file/module, so no new SGR class is
// introduced.
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CONNECTION_COLOR: Record<ConnectionStatus, string> = {
  open: "\x1b[32m",
  connecting: "\x1b[33m",
  error: "\x1b[31m",
  closed: "\x1b[90m",
};

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

// DH-0065 liveness: a braille spinner shown in the header whenever the root agent's own
// status is "running" — distinct from `rootActive` (which, once true, never resets; see
// its doc comment in types.ts) and from the tree/agent view's elapsed counter, neither of
// which give any "still alive" signal on the always-visible root view during a long turn.
// Advances off `state.now`, which only moves via the reducer's `tick` action, so this stays
// a pure function of state (no wall-clock reads inside the render layer).
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 120;

function spinnerFrame(now: number): string {
  const index = Math.floor(now / SPINNER_FRAME_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[index] as string;
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

// DH-0065: distinct per-role gutter markers so a user turn reads apart from an agent turn "at
// a glance" in a long scrollback, not just via a same-color two-character prefix. Both
// markers are exactly `TRANSCRIPT_GUTTER_COLS` visual columns wide so every row (marker or
// continuation) lines up in a stable left column, the same "gutter" convention already used
// for blockquotes/code blocks in markdown-ansi.ts. Colors reuse codes already emitted
// elsewhere in this file (STATUS_COLOR's 33/36 below) — no new SGR class, per the DH-0056 D3
// allowlist constraint.
const USER_ROLE_SGR = "\x1b[1;33m"; // bold yellow — matches the input box's own "> " marker
const AGENT_ROLE_SGR = "\x1b[36m"; // cyan — pairs with the tree view's "●" status-glyph language
const TRANSCRIPT_GUTTER_COLS = 2; // "> ", "● ", and "⚙ " are all exactly 2 visual columns
const TRANSCRIPT_CONT_GUTTER = "  "; // continuation rows: aligned blank indent, no marker

/** Render a conversation transcript with real turn separation: each turn wrapped to
 * `cols - TRANSCRIPT_GUTTER_COLS`, a blank line between consecutive turns, and every row
 * (first row and any wrapped continuation) prefixed with a role-colored gutter — `"> "` in
 * bold yellow for a user turn's first row, `"● "` in cyan for an agent turn's, and a plain
 * blank indent of the same width on continuation rows, so the whole transcript reads as two
 * visually distinct, left-aligned columns of turns rather than a same-color wall of text
 * (Round 6, docs/handoffs/tui.md; DH-0065 review: "the only cue is a two-character prefix in
 * the same default color as everything else").
 *
 * Assistant turns are rendered as Markdown (DH-0056): parsed via `parseMarkdown` (which
 * applies the defensive `sanitizeText` escape-stripping unconditionally as its own step
 * zero) and turned into styled, reset-terminated ANSI rows by `markdown-ansi.ts`'s safe SGR
 * allowlist — never a raw passthrough of model-authored bytes. User turns are the operator's
 * own echoed input, not Markdown, so they're only run through `sanitizeText` and wrapped as
 * plain text. `"tool"` turns (DH-0065, `state.ts`'s `appendToolMarker`) are synthetic
 * one-line markers — e.g. a sub-agent spawn — rendered dim with a `"⚙ "` marker, kept
 * visually subordinate to real conversation content per the ticket's "kept visually
 * subordinate to text output" requirement. */
export function renderTranscript(transcript: Turn[], cols: number): string[] {
  const lines: string[] = [];
  const innerCols = Math.max(1, cols - TRANSCRIPT_GUTTER_COLS);
  transcript.forEach((turn, index) => {
    if (index > 0) lines.push("");
    if (turn.role === "user") {
      const rows = wrapText(sanitizeText(turn.text), innerCols);
      rows.forEach((row, i) => {
        const gutter = i === 0 ? `${USER_ROLE_SGR}>${RESET} ` : TRANSCRIPT_CONT_GUTTER;
        lines.push(`${gutter}${row}`);
      });
    } else if (turn.role === "tool") {
      const rows = wrapText(sanitizeText(turn.text), innerCols);
      rows.forEach((row, i) => {
        const marker = i === 0 ? "⚙ " : TRANSCRIPT_CONT_GUTTER;
        lines.push(`${DIM}${marker}${row}${RESET}`);
      });
    } else {
      const rows = renderMarkdownRows(parseMarkdown(turn.text), innerCols);
      rows.forEach((row, i) => {
        const gutter = i === 0 ? `${AGENT_ROLE_SGR}●${RESET} ` : TRANSCRIPT_CONT_GUTTER;
        lines.push(`${gutter}${row}`);
      });
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
  const totalsSuffix = dim(
    `  —  ${formatTokenCost(totals.inputTokens, totals.outputTokens, totals.costUsd)}`,
  );
  const appName = `${BOLD}Dark Harness${RESET}`;
  const connection = `${CONNECTION_COLOR[state.connection]}${state.connection}${RESET}`;
  // DH-0065 liveness: a spinner next to the connection pill whenever the root agent is
  // actively "running" — the root view otherwise gives no live sign the agent is thinking
  // during a long turn (only the tree/agent view's elapsed counter did).
  const rootAgentInfo = state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;
  const spinnerSuffix =
    rootAgentInfo?.status === "running" ? `  ${spinnerFrame(state.now)} working…` : "";
  const title = `${appName} — ${viewLabel(state)} — ${connection}${spinnerSuffix}${totalsSuffix}${sessionSuffix}${reconnectSuffix}`;
  const separator = dim("─".repeat(Math.max(1, cols)));
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
  const hint = state.statusMessage ?? dim("[Enter] send   [←] agent tree   [Ctrl+C] quit");
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
      footer: [state.statusMessage ?? dim("[↑/↓] navigate   [Enter] open   [Esc] back")],
    };
  }
  const entryTexts = flat.map((entry, index) => {
    const marker = index === selectedIndex ? "> " : "  ";
    const glyph = colorizeStatus(entry.node.status, "●");
    // DH-0065: the status glyph is never the only cue — color-blind operators can't rely on
    // it, so the status word itself is always shown too (same color as the glyph, but legible
    // regardless of color perception).
    const statusWord = colorizeStatus(entry.node.status, entry.node.status);
    // DH-0069: prefer the Agent tool's `description` — a human-readable label ("Fix flaky
    // retry test") instead of a raw agentId/UUID — falling back to the old `agentId (model)`
    // format only when it's absent (the root agent, which never has one, or a pre-DH-0069
    // session logged before description became required).
    const label = entry.node.description ?? `${entry.node.agentId} (${entry.node.model})`;
    const trackedAgent = state.agents.get(entry.node.agentId);
    // DH-0065: elapsed is only meaningful — and only shown — while the agent is still
    // active (running/waiting): "time in current status", using `statusSince` rather than
    // `lastEventAt`. For a terminal agent (done/failed/stopped) this counter used to keep
    // ticking up forever alongside every render tick, which reads as "stuck"; terminal rows
    // simply omit it now rather than show a static-but-still-wrong number.
    const isActive = entry.node.status === "running" || entry.node.status === "waiting";
    const elapsed =
      trackedAgent === undefined || !isActive
        ? ""
        : `  [${formatElapsed(state.now - trackedAgent.statusSince)}]`;
    const tokens =
      trackedAgent === undefined
        ? ""
        : `  ${formatTokenCost(trackedAgent.inputTokens, trackedAgent.outputTokens, trackedAgent.costUsd)}`;
    return `${marker}${entry.prefix}${glyph} ${statusWord}  ${label}${elapsed}${tokens}`;
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
  const hint = state.statusMessage ?? `${meta}   —   ${dim("[Esc] back to root (read-only)")}`;
  return { content: padRows(content, contentRows), footer: [hint] };
}

/** Render the full frame as an exact-height array of plain rows (no leading/trailing ANSI). */
export function renderFrame(state: TuiState): string[] {
  const { rows, cols } = state.size;
  // DH-0095: every view's content is wrapped/measured against `innerCols`, not the raw
  // terminal width, so nothing ever reaches the left/right edge; `applyMargin` below adds
  // the actual left-side space back onto each finished row.
  const innerCols = Math.max(1, cols - 2 * MARGIN);
  const header = headerRows(state, innerCols);
  const footerRows = state.view.kind === "root" ? 2 : 1;
  const contentRows = Math.max(0, rows - HEADER_ROWS - footerRows);

  const { content, footer } =
    state.view.kind === "root"
      ? renderRoot(state, contentRows, innerCols)
      : state.view.kind === "tree"
        ? renderTree(state, contentRows, innerCols)
        : renderAgent(state, contentRows, innerCols);

  const frame = [...header, ...content, ...footer].map(applyMargin);
  return padRows(frame, rows);
}

/** Turn plain rows into a full-redraw ANSI frame: cursor home, each row followed by
 * clear-to-end-of-line, then clear-to-end-of-screen so a shorter frame doesn't leave
 * stale characters from a taller previous one. */
export function frameToAnsi(rows: string[]): string {
  const body = rows.map((row) => `${row}\x1b[K`).join("\n");
  return `\x1b[H${body}\x1b[J`;
}
