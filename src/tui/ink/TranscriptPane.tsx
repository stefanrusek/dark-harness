// DH-0136: transcript pane, folding in DH-0126's deferred scrollable-transcript-UI remainder
// (windowing via the ported `scroll-viewport.ts` module) and DH-0130's per-agent terminal-
// status marker display. Ported from render.ts's `renderTranscript`/`tailLines`.
//
// Scroll offset is owned locally (component state), not the `TuiState` reducer — matching
// privateer's "controller stores just the offset" split (scroll-viewport.ts's own doc comment)
// and keeping `state.ts` free of render-only offset bookkeeping (DH-0133's own User Story:
// reducer requires no behavioral changes beyond what DH-0126/DH-0130 independently need).
// DH-0126: mouse-wheel input is parsed off raw stdin in app.ts (see mouse.ts/mouse-lifecycle.ts)
// and forwarded here via `scrollBus` (ink/scroll-bus.ts) rather than through the reducer —
// this component subscribes and applies the delta to its local offset itself.
import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { STATUS_TOKENS } from "../../design-tokens.ts";
import { parseMarkdown, sanitizeText } from "../../markdown/index.ts";
import { groupTranscript, isGroupableToolTurn } from "../../transcript-grouping.ts";
import { renderMarkdownRows } from "../markdown-ansi.ts";
import { atBottom, scrollBy, toBottom, visibleSlice } from "../scroll-viewport.ts";
import type { Turn } from "../types.type.ts";
import { stripInkUnsafeCombining, wrapText } from "../width.ts";
import type { ScrollBus } from "./scroll-bus.ts";
import type { ToolFocusBus, ToolFocusEvent } from "./tool-focus-bus.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const USER_ROLE_SGR = "\x1b[1;33m";
const AGENT_ROLE_SGR = "\x1b[36m";
const TRANSCRIPT_GUTTER_COLS = 2;
const TRANSCRIPT_CONT_GUTTER = "  ";
const TOOL_ERROR_SGR = "\x1b[31m";
/** DH-0246: the focused-row gutter marker — same literal "> " AgentTree/PickerView already use
 * for their own `selectedIndex` row (see AgentTree.tsx's `entryTexts` map / PickerView.tsx's
 * `rows` map), reused here rather than inventing a new focus convention for this pane. */
const FOCUS_MARKER = "> ";

const EMPTY_NUMBER_SET: ReadonlySet<number> = Object.freeze(new Set<number>());

/** DH-0246: the flattened, keyboard-navigable list of tool-call rows currently visible — a
 * collapsed group contributes exactly one row (its "N tool calls" header); an expanded group
 * additionally contributes one row per member, immediately after its header, matching
 * DH-0199's Web design (the group header always toggles collapse; each member independently
 * toggles its own detail). Non-tool turns (user/assistant/system, and DH-0130 terminal-status
 * markers) are never part of this list — they render inline via `renderTranscript` but aren't
 * focusable/activatable, matching this ticket's scope ("a tool-call row (standalone or inside
 * an expanded group)"). `index`/`startIndex` are transcript indices — stable identity for an
 * append-only transcript, used as expand-state keys below. */
export type FocusRow =
  | { kind: "group"; startIndex: number; turns: Turn[] }
  | { kind: "tool"; index: number; turn: Turn };

export function buildFocusRows(
  transcript: Turn[],
  expandedGroups: ReadonlySet<number>,
): FocusRow[] {
  const rows: FocusRow[] = [];
  for (const item of groupTranscript(transcript)) {
    if (item.kind === "turn") {
      if (isGroupableToolTurn(item.turn)) {
        rows.push({ kind: "tool", index: item.startIndex, turn: item.turn });
      }
      continue;
    }
    rows.push({ kind: "group", startIndex: item.startIndex, turns: item.turns });
    if (expandedGroups.has(item.startIndex)) {
      item.turns.forEach((turn, j) => {
        rows.push({ kind: "tool", index: item.startIndex + j, turn });
      });
    }
  }
  return rows;
}

/** DH-0246: input summary + success/error/duration for one tool-call row's expanded detail —
 * the wire protocol carries no raw tool output (`ToolResultEvent` has none by design, see its
 * doc comment in `src/contracts/events.type.ts`), so this is the entire "result" a client can
 * ever show. Mirrors `Transcript.tsx`'s `ToolCallDetail` (DH-0199). */
function toolResultSummary(turn: Turn): string {
  const resolved = turn.durationMs !== undefined || turn.toolError;
  if (!resolved) return "pending…";
  const status = turn.toolError ? "✗ error" : "✓ ok";
  return turn.durationMs !== undefined ? `${status} · ${turn.durationMs}ms` : status;
}

function renderToolDetailLines(turn: Turn, innerCols: number): string[] {
  const lines: string[] = [];
  const inputRows = wrapText(
    sanitizeText(`Input: ${stripInkUnsafeCombining(turn.text)}`),
    innerCols,
  );
  inputRows.forEach((row) => {
    lines.push(`${DIM}${TRANSCRIPT_CONT_GUTTER}${row}${RESET}`);
  });
  lines.push(`${DIM}${TRANSCRIPT_CONT_GUTTER}Result: ${toolResultSummary(turn)}${RESET}`);
  return lines;
}

function renderToolRow(
  turn: Turn,
  innerCols: number,
  focused: boolean,
  detailExpanded: boolean,
): string[] {
  const rows = wrapText(sanitizeText(stripInkUnsafeCombining(turn.text)), innerCols);
  const lines: string[] = [];
  rows.forEach((row, i) => {
    const marker = i === 0 ? (focused ? FOCUS_MARKER : "⚙ ") : TRANSCRIPT_CONT_GUTTER;
    const suffix = i === rows.length - 1 && turn.toolError ? ` ${TOOL_ERROR_SGR}✗${RESET}` : "";
    lines.push(`${DIM}${marker}${row}${RESET}${suffix}`);
  });
  if (detailExpanded) lines.push(...renderToolDetailLines(turn, innerCols));
  return lines;
}

function renderGroupHeader(turns: Turn[], focused: boolean, expanded: boolean): string {
  const errorCount = turns.filter((t) => t.toolError).length;
  const marker = focused ? FOCUS_MARKER : "  ";
  const caret = expanded ? "▾" : "▸";
  const summary = `${turns.length} tool calls${errorCount > 0 ? ` (${errorCount} failed)` : ""}`;
  return `${DIM}${marker}${caret} ${summary}${RESET}`;
}

/** DH-0246: which tool-call groups/rows are currently expanded, and which row (if any) is
 * focused — all local to `TranscriptPane` (see `tool-focus-bus.ts`'s header comment for why),
 * never lifted into `TuiState`. */
export interface TranscriptFocusState {
  focusIndex: number;
  expandedGroups: ReadonlySet<number>;
  expandedTools: ReadonlySet<number>;
}

/** Render a conversation transcript with real turn separation — ported verbatim from
 * render.ts's `renderTranscript` (see that file's history for the full design rationale: user
 * turns plain-wrapped, assistant turns through the Markdown/SGR-allowlist pipeline, `"tool"`
 * marker turns dim with a "⚙" glyph — except a DH-0130 `terminalStatus`-tagged marker, which
 * uses DH-0137's status token glyph/color/word instead of the generic dim styling).
 *
 * DH-0246: consecutive groupable tool-call turns (`transcript-grouping.ts`'s `groupTranscript`)
 * now render as a single collapsed-by-default "N tool calls" row instead of one line per call;
 * `focus` (optional, defaulting to "nothing focused/expanded") carries the per-row
 * focus/expand state a caller (`TranscriptPane` below) owns locally. Omitting it reproduces
 * pre-DH-0246 behavior exactly for any transcript with no run of 2+ tool calls. */
export function renderTranscript(
  transcript: Turn[],
  cols: number,
  focus?: TranscriptFocusState,
): string[] {
  const lines: string[] = [];
  const innerCols = Math.max(1, cols - TRANSCRIPT_GUTTER_COLS);
  const expandedGroups = focus?.expandedGroups ?? EMPTY_NUMBER_SET;
  const expandedTools = focus?.expandedTools ?? EMPTY_NUMBER_SET;
  const focusIndex = focus?.focusIndex ?? -1;
  let rowCounter = 0;
  let first = true;

  const items = groupTranscript(transcript);
  items.forEach((item) => {
    if (!first) lines.push("");
    first = false;
    if (item.kind === "turn" && !isGroupableToolTurn(item.turn)) {
      const turn = item.turn;
      // DH-0214: strip codepoints Ink's own grid-placement layer can't place without
      // drifting (see stripInkUnsafeCombining's doc comment) before any wrap/markdown
      // pipeline sees the text — every branch below eventually hands its output to Ink's
      // <Text>.
      const text = stripInkUnsafeCombining(turn.text);
      if (turn.role === "user") {
        const rows = wrapText(sanitizeText(text), innerCols);
        rows.forEach((row, i) => {
          const gutter = i === 0 ? `${USER_ROLE_SGR}>${RESET} ` : TRANSCRIPT_CONT_GUTTER;
          lines.push(`${gutter}${row}`);
        });
      } else if (turn.role === "tool") {
        // A terminal-status marker: never groupable (see isGroupableToolTurn), so it's
        // always a lone `"turn"` item — unchanged from pre-DH-0246 rendering.
        const rows = wrapText(sanitizeText(text), innerCols);
        const token = STATUS_TOKENS[turn.terminalStatus as keyof typeof STATUS_TOKENS];
        rows.forEach((row, i) => {
          const gutter =
            i === 0 ? `\x1b[${token.sgr}m${token.glyph}${RESET} ` : TRANSCRIPT_CONT_GUTTER;
          lines.push(`${gutter}\x1b[${token.sgr}m${row}${RESET}`);
        });
      } else {
        const rows = renderMarkdownRows(parseMarkdown(text), innerCols);
        rows.forEach((row, i) => {
          const gutter = i === 0 ? `${AGENT_ROLE_SGR}●${RESET} ` : TRANSCRIPT_CONT_GUTTER;
          lines.push(`${gutter}${row}`);
        });
      }
      return;
    }
    if (item.kind === "turn") {
      // A standalone (unrouped) groupable tool call — one focusable row.
      const focused = rowCounter === focusIndex;
      lines.push(
        ...renderToolRow(item.turn, innerCols, focused, expandedTools.has(item.startIndex)),
      );
      rowCounter++;
      return;
    }
    // A group of 2+ consecutive tool calls: the header is always one focusable row; expanded
    // members contribute one focusable row each right after it (see buildFocusRows above,
    // which this loop's row-counting deliberately stays in lockstep with).
    const expanded = expandedGroups.has(item.startIndex);
    const headerFocused = rowCounter === focusIndex;
    lines.push(renderGroupHeader(item.turns, headerFocused, expanded));
    rowCounter++;
    if (expanded) {
      item.turns.forEach((turn, j) => {
        const turnIndex = item.startIndex + j;
        const focused = rowCounter === focusIndex;
        lines.push(...renderToolRow(turn, innerCols, focused, expandedTools.has(turnIndex)));
        rowCounter++;
      });
    }
  });
  return lines;
}

export interface TranscriptPaneProps {
  transcript: Turn[];
  cols: number;
  height: number;
  /** DH-0124: may contain "\n" to render a multi-line empty state (e.g. RootView's
   * header + friendly first-message prompt); split into one row per line. */
  emptyText: string;
  /** DH-0245: lines always shown at the top of the pane, ahead of `emptyText`/the real
   * transcript, whether or not any turns exist yet — a synthetic leading entry in this
   * pane's own row list so it participates in the same windowing/scroll-offset math
   * (`scroll-viewport.ts`) as everything else: it persists once the first turn is sent (the
   * body switches from `emptyText` to `renderTranscript`'s output, but these rows stay put
   * at the top) and scrolls back into view when the operator scrolls to offset 0. Used by
   * `RootView` for the in-session Header A2 banner; omitted (or empty) elsewhere (e.g.
   * `AgentView`'s per-agent pane has no such banner). */
  headerLines?: string[];
  /** DH-0126: wheel-scroll trigger, wired up by whichever view (root/agent) currently mounts
   * this pane — see app.ts/mouse.ts for where the raw SGR events are parsed. Optional so
   * existing tests that render `<TranscriptPane>` standalone don't need to supply one. */
  scrollBus?: ScrollBus;
  /** DH-0246: up/down/activate trigger for tool-call row focus and expand/collapse — same
   * pattern as `scrollBus` (see `tool-focus-bus.ts`'s header comment for why this is a bus
   * rather than `TuiState`). Optional so existing tests/other views don't need to supply one. */
  toolFocusBus?: ToolFocusBus;
}

export function TranscriptPane({
  transcript,
  cols,
  height,
  emptyText,
  headerLines,
  scrollBus,
  toolFocusBus,
}: TranscriptPaneProps) {
  // DH-0246: all local — see `TranscriptFocusState`'s doc comment. `focusIndex` starts at 0
  // (the first focusable tool row, if any) rather than -1/"nothing focused" so a lone Enter
  // press activates something immediately, matching AgentTree/PickerView's own
  // always-something-selected convention.
  const [focusIndex, setFocusIndex] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<number>>(EMPTY_NUMBER_SET);
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<number>>(EMPTY_NUMBER_SET);

  const focusRows = buildFocusRows(transcript, expandedGroups);
  // Clamp during render (same "adjust state during render" pattern the scroll-offset math
  // below already uses) rather than via effect — the row count can shrink (a group collapses)
  // or grow (a group expands) as a direct result of this same render's `expandedGroups`
  // change, and the clamp needs to apply before `renderTranscript` reads `focusIndex` a few
  // lines down, not one tick later.
  // `Math.max(focusIndex, 0)` before the `Math.min` matters: an empty transcript clamps
  // `focusIndex` down to -1 below (nothing to focus yet), and without the floor here, once
  // real tool rows later appear `Math.min(-1, focusRows.length - 1)` would stay stuck at -1
  // forever (-1 is <= every non-negative `length - 1`) instead of snapping back to row 0.
  const clampedFocusIndex =
    focusRows.length === 0 ? -1 : Math.min(Math.max(focusIndex, 0), focusRows.length - 1);
  if (clampedFocusIndex !== focusIndex) setFocusIndex(clampedFocusIndex);

  useEffect(() => {
    if (!toolFocusBus) return;
    return toolFocusBus.subscribe((event: ToolFocusEvent) => {
      if (focusRows.length === 0) return;
      if (event === "up") {
        setFocusIndex((prev) => Math.max(0, Math.min(prev, focusRows.length - 1) - 1));
        return;
      }
      if (event === "down") {
        setFocusIndex((prev) => Math.min(focusRows.length - 1, Math.max(prev, 0) + 1));
        return;
      }
      // "activate": toggle whatever's currently focused — a group header toggles its
      // collapsed/expanded state (DH-0199's "click to expand/collapse"), a tool row (standalone
      // or an expanded group's member) toggles its own input+result detail.
      const row = focusRows[Math.min(clampedFocusIndex, focusRows.length - 1)];
      if (!row) return;
      if (row.kind === "group") {
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(row.startIndex)) next.delete(row.startIndex);
          else next.add(row.startIndex);
          return next;
        });
        return;
      }
      setExpandedTools((prev) => {
        const next = new Set(prev);
        if (next.has(row.index)) next.delete(row.index);
        else next.add(row.index);
        return next;
      });
    });
    // Re-subscribe each render so the listener closes over the current `focusRows`/
    // `clampedFocusIndex` (derived above from `transcript`/`expandedGroups`) rather than stale
    // values from mount — same pattern as `scrollBus`'s subscription below.
  }, [toolFocusBus, focusRows, clampedFocusIndex]);

  const bodyLines =
    transcript.length === 0
      ? emptyText.split("\n")
      : renderTranscript(transcript, cols, {
          focusIndex: clampedFocusIndex,
          expandedGroups,
          expandedTools,
        });
  const lines =
    headerLines && headerLines.length > 0 ? [...headerLines, "", ...bodyLines] : bodyLines;
  const [offset, setOffset] = useState(() => toBottom(lines.length, height).offset);

  // Re-subscribe each render so the listener closes over the current lines/height — a scroll
  // event applies against the viewport as it exists right now, not as it existed when the
  // pane first mounted.
  useEffect(() => {
    if (!scrollBus) return;
    return scrollBus.subscribe((deltaLines) => {
      setOffset((prev) => scrollBy({ offset: prev }, deltaLines, lines.length, height).offset);
    });
  }, [scrollBus, lines.length, height]);
  // "Adjust state during render in response to a prop change" — the documented React pattern
  // for deriving state from props without an effect (avoids relying on effects actually
  // flushing before `lastFrame()` is read in ink-testing-library, which they don't). Tracked
  // via refs rather than useEffect so a rerender reveals new content synchronously, in the same
  // pass, when the pane was already scrolled to the bottom (DH-0129-equivalent auto-scroll);
  // if the operator had scrolled up, the offset (and thus wasAtBottom) is left untouched.
  const prevLinesLengthRef = useRef(lines.length);
  const prevHeightRef = useRef(height);
  const wasAtBottomRef = useRef(true);
  let effectiveOffset = offset;
  if (lines.length !== prevLinesLengthRef.current || height !== prevHeightRef.current) {
    prevLinesLengthRef.current = lines.length;
    prevHeightRef.current = height;
    if (wasAtBottomRef.current) {
      effectiveOffset = toBottom(lines.length, height).offset;
      if (effectiveOffset !== offset) setOffset(effectiveOffset);
    }
  }
  wasAtBottomRef.current = atBottom(effectiveOffset, lines.length, height);

  const visible = visibleSlice(lines, effectiveOffset, height);
  const padded = visible.slice(0, height);
  while (padded.length < height) padded.push("");

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {padded.map((row, index) => {
        // Rows are a fixed-height positional window, not a keyed/reorderable list — index is
        // the correct identity here (same convention as App.tsx's pre-componentized frame rows).
        const rowKey = index;
        return row === "" ? <Box key={rowKey} height={1} /> : <Text key={rowKey}>{row}</Text>;
      })}
    </Box>
  );
}
