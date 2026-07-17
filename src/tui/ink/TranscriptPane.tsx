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
import { renderMarkdownRows } from "../markdown-ansi.ts";
import { atBottom, scrollBy, toBottom, visibleSlice } from "../scroll-viewport.ts";
import type { Turn } from "../types.ts";
import { wrapText } from "../width.ts";
import type { ScrollBus } from "./scroll-bus.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const USER_ROLE_SGR = "\x1b[1;33m";
const AGENT_ROLE_SGR = "\x1b[36m";
const TRANSCRIPT_GUTTER_COLS = 2;
const TRANSCRIPT_CONT_GUTTER = "  ";
const TOOL_ERROR_SGR = "\x1b[31m";

/** Render a conversation transcript with real turn separation — ported verbatim from
 * render.ts's `renderTranscript` (see that file's history for the full design rationale: user
 * turns plain-wrapped, assistant turns through the Markdown/SGR-allowlist pipeline, `"tool"`
 * marker turns dim with a "⚙" glyph — except a DH-0130 `terminalStatus`-tagged marker, which
 * uses DH-0137's status token glyph/color/word instead of the generic dim styling). */
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
      if (turn.terminalStatus) {
        const token = STATUS_TOKENS[turn.terminalStatus];
        rows.forEach((row, i) => {
          const gutter =
            i === 0 ? `\x1b[${token.sgr}m${token.glyph}${RESET} ` : TRANSCRIPT_CONT_GUTTER;
          lines.push(`${gutter}\x1b[${token.sgr}m${row}${RESET}`);
        });
        return;
      }
      rows.forEach((row, i) => {
        const marker = i === 0 ? "⚙ " : TRANSCRIPT_CONT_GUTTER;
        const suffix = i === rows.length - 1 && turn.toolError ? ` ${TOOL_ERROR_SGR}✗${RESET}` : "";
        lines.push(`${DIM}${marker}${row}${RESET}${suffix}`);
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

export interface TranscriptPaneProps {
  transcript: Turn[];
  cols: number;
  height: number;
  /** DH-0124: may contain "\n" to render a multi-line empty state (e.g. RootView's
   * header + friendly first-message prompt); split into one row per line. */
  emptyText: string;
  /** DH-0126: wheel-scroll trigger, wired up by whichever view (root/agent) currently mounts
   * this pane — see app.ts/mouse.ts for where the raw SGR events are parsed. Optional so
   * existing tests that render `<TranscriptPane>` standalone don't need to supply one. */
  scrollBus?: ScrollBus;
}

export function TranscriptPane({
  transcript,
  cols,
  height,
  emptyText,
  scrollBus,
}: TranscriptPaneProps) {
  const lines =
    transcript.length === 0 ? emptyText.split("\n") : renderTranscript(transcript, cols);
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
