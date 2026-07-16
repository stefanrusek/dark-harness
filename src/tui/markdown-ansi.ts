// Renders a `dh` Markdown AST (src/markdown/index.ts) to plain-text rows carrying only a
// small, client-controlled allowlist of ANSI SGR escape codes (DH-0056 D3). This is the
// *only* place in the TUI that turns Markdown structure into color/style bytes — the model's
// own raw text is never concatenated into the output as a literal escape sequence; every byte
// of ANSI this module emits comes from the `SGR` constant table below, never from parsed
// text content.
//
// Exact allowlist (grep-able in one place, per the ticket): SGR codes 0 (reset), 1 (bold), 2
// (dim), 3 (italic), 4 (underline), 9 (strikethrough), plus standard/bright foreground colors
// 30-37/90-97 and default-foreground 39. No background codes, no 256/true-color (`38;5`/
// `38;2`) — 16-color foreground keeps every terminal in scope, and backgrounds interact badly
// with `render.ts`'s `\x1b[K` per-row erase-to-end-of-line framing. Never OSC, DCS, cursor
// movement, erase, scroll-region, DA/DSR, or private-mode-set sequences — see the ticket for
// exactly which attack each excluded class defends against (clipboard injection via OSC 52,
// terminal-reply-as-keystroke injection via DA/DSR, alt-screen/frame hijack via cursor/erase
// CSI, etc.). This renderer structurally cannot emit any of those: it only ever concatenates
// the allowlisted constants below with plain text.
//
// Load-bearing wrapping detail: `wrapText`'s codepoint/width-aware slicing (src/tui/width.ts)
// must never see SGR bytes, so this module works in a styled-segment domain — `{ text,
// style }[]` per logical line — and only serializes ANSI as the very last step, once
// wrapping/measuring is done. Every emitted row is self-contained: a style is re-opened at
// the start of a wrapped continuation row (each segment carries its own style prefix) and
// every row produced here ends with `\x1b[0m`, so `tailLines` slicing and `frameToAnsi`'s
// per-row `\x1b[K` framing in render.ts stay row-local — no style can leak into header/footer
// rows.

import type { BlockNode, InlineNode } from "../markdown/index.ts";
import { charWidth, codePoints, stringWidth } from "./width.ts";

const RESET = "\x1b[0m";

/** The exact SGR allowlist (DH-0056 D3) — the only escape codes this module may combine into
 * output. Keep this the single grep-able source of truth for "what can this renderer emit". */
const SGR = {
  bold: "1",
  dim: "2",
  italic: "3",
  underline: "4",
  strike: "9",
  cyan: "36",
  blue: "34",
} as const;

interface Segment {
  text: string;
  codes: readonly string[];
}

function sgrPrefix(codes: readonly string[]): string {
  return codes.length === 0 ? "" : `\x1b[${codes.join(";")}m`;
}

/** Inline AST -> logical lines of styled segments, splitting on embedded `"\n"` text (from
 * dh Markdown's "preserved line breaks" paragraph rule) so each logical line can be wrapped
 * independently by `wrapSegments`. */
function inlineToLines(nodes: InlineNode[], codes: readonly string[]): Segment[][] {
  const lines: Segment[][] = [[]];

  const emit = (text: string, segCodes: readonly string[]): void => {
    const parts = text.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part !== "") (lines[lines.length - 1] as Segment[]).push({ text: part, codes: segCodes });
    });
  };

  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        emit(node.text, codes);
        break;
      case "strong":
        appendLines(lines, inlineToLines(node.children, [...codes, SGR.bold]));
        break;
      case "emphasis":
        appendLines(lines, inlineToLines(node.children, [...codes, SGR.italic]));
        break;
      case "strike":
        appendLines(lines, inlineToLines(node.children, [...codes, SGR.strike]));
        break;
      case "code":
        emit(node.text, [...codes, SGR.cyan]);
        break;
      case "link":
        appendLines(lines, inlineToLines(node.children, [...codes, SGR.underline, SGR.blue]));
        emit(` (${node.url})`, codes);
        break;
    }
  }
  return lines;
}

/** Merges a nested `inlineToLines` result into the running `lines` accumulator: the first
 * produced line continues the current trailing line, any further lines are new logical
 * lines. Needed because a single inline child (e.g. `**bold text**`) can itself contain an
 * embedded newline. */
function appendLines(lines: Segment[][], more: Segment[][]): void {
  if (more.length === 0) return;
  const [first, ...rest] = more;
  (lines[lines.length - 1] as Segment[]).push(...(first as Segment[]));
  for (const line of rest) lines.push(line);
}

interface Token {
  text: string;
  codes: readonly string[];
  isSpace: boolean;
}

/** Flatten one logical line's styled segments into whitespace/non-whitespace tokens, keeping
 * each token's originating segment's style codes — the styled-segment counterpart of
 * `width.ts`'s `tokenizeWords`. */
function tokenizeSegments(line: Segment[]): Token[] {
  const tokens: Token[] = [];
  for (const seg of line) {
    for (const part of seg.text.match(/\s+|\S+/g) ?? []) {
      tokens.push({ text: part, codes: seg.codes, isSpace: /^\s+$/.test(part) });
    }
  }
  return tokens;
}

/** Drop any trailing whitespace-only tokens (a wrapped/final row should never end with a
 * dangling space, matching `width.ts`'s plain-text trim). */
function trimTrailingWhitespace(parts: { text: string; codes: readonly string[] }[]): void {
  while (parts.length > 0 && /^\s+$/.test((parts[parts.length - 1] as { text: string }).text)) {
    parts.pop();
  }
}

/** Wrap one logical line of styled segments to `cols` visual columns (DH-0065: word-boundary
 * aware — prefers breaking at the last whitespace token before the limit, falling back to a
 * codepoint/display-width hard break only for a single token wider than a whole row), measuring
 * by codepoint width only (never counting the segment's own style bytes) and re-opening each
 * segment's style at the start of every wrapped row. */
function wrapSegments(line: Segment[], cols: number): string[] {
  const width = Math.max(1, cols);
  const tokens = tokenizeSegments(line);
  const rows: string[] = [];
  let rowParts: { text: string; codes: readonly string[] }[] = [];
  let rowWidth = 0;
  let justWrapped = false;

  const pushPart = (text: string, codes: readonly string[]): void => {
    if (text !== "") rowParts.push({ text, codes });
  };

  const flushRow = (): void => {
    trimTrailingWhitespace(rowParts);
    rows.push(serializeRow(rowParts));
    rowParts = [];
    rowWidth = 0;
    justWrapped = true;
  };

  for (const token of tokens) {
    const tokenWidth = stringWidth(token.text);
    if (token.isSpace) {
      if (justWrapped) continue; // never start a wrapped continuation row with whitespace
      if (rowWidth + tokenWidth > width) {
        flushRow();
        continue;
      }
      pushPart(token.text, token.codes);
      rowWidth += tokenWidth;
      continue;
    }
    justWrapped = false;
    if (tokenWidth > width) {
      // Token alone exceeds a full row: flush what's pending, then hard-break just this token.
      if (rowParts.length > 0) flushRow();
      let cur = "";
      let curWidth = 0;
      for (const cp of codePoints(token.text)) {
        const w = charWidth(cp);
        if (curWidth + w > width && cur.length > 0) {
          pushPart(cur, token.codes);
          flushRow();
          cur = "";
          curWidth = 0;
        }
        cur += cp;
        curWidth += w;
      }
      pushPart(cur, token.codes);
      rowWidth = curWidth;
      continue;
    }
    if (rowWidth + tokenWidth > width) flushRow();
    pushPart(token.text, token.codes);
    rowWidth += tokenWidth;
  }
  trimTrailingWhitespace(rowParts);
  rows.push(serializeRow(rowParts));
  return rows;
}

function serializeRow(parts: { text: string; codes: readonly string[] }[]): string {
  if (parts.length === 0) return "";
  const hasStyle = parts.some((p) => p.codes.length > 0);
  // Every style transition must be explicit (DH-0065): a segment that follows a *styled*
  // segment always gets an explicit RESET before its own (possibly empty) SGR prefix, so an
  // unstyled — or differently-styled — segment can never inherit the previous segment's SGR
  // state. Without this, a segment with an empty code set emitted no prefix at all and the
  // terminal simply kept whatever bold/italic/color state the prior segment left active,
  // bleeding it into the rest of the row (and, via re-opened continuation segments, into
  // wrapped rows too). The very first segment of a row never needs a leading reset — every
  // row this module produces starts from clean terminal state by construction (each row is
  // reset-terminated, per the module header comment).
  const body = parts
    .map((p, i) => {
      const prevStyled = i > 0 && (parts[i - 1] as { codes: readonly string[] }).codes.length > 0;
      const prefix = prevStyled ? `${RESET}${sgrPrefix(p.codes)}` : sgrPrefix(p.codes);
      return `${prefix}${p.text}`;
    })
    .join("");
  return hasStyle ? `${body}${RESET}` : body;
}

function renderInlineBlock(
  children: InlineNode[],
  codes: readonly string[],
  cols: number,
): string[] {
  const lines = inlineToLines(children, codes);
  return lines.flatMap((line) => wrapSegments(line, cols));
}

function renderBlock(block: BlockNode, cols: number): string[] {
  switch (block.kind) {
    case "paragraph":
      return renderInlineBlock(block.children, [], cols);
    case "heading": {
      const codes: readonly string[] = block.level === 1 ? [SGR.bold, SGR.underline] : [SGR.bold];
      return renderInlineBlock(block.children, codes, cols);
    }
    case "codeBlock": {
      const gutter = `${sgrPrefix([SGR.dim])}│ `;
      const innerCols = Math.max(1, cols - 2);
      const lines = block.text.length === 0 ? [""] : block.text.split("\n");
      return lines.flatMap((l) => wrapPlainDim(l, innerCols).map((r) => `${gutter}${r}${RESET}`));
    }
    case "thematicBreak":
      return [`${sgrPrefix([SGR.dim])}${"─".repeat(Math.max(1, cols))}${RESET}`];
    case "blockquote": {
      const innerCols = Math.max(1, cols - 2);
      const inner = renderBlocks(block.children, innerCols);
      const gutter = `${sgrPrefix([SGR.dim])}│${RESET} `;
      return inner.map((r) => `${gutter}${r}`);
    }
    case "list":
      return renderListBlock(block, cols);
  }
}

function renderListBlock(block: Extract<BlockNode, { kind: "list" }>, cols: number): string[] {
  const rows: string[] = [];
  block.items.forEach((item, i) => {
    const marker = block.ordered ? `${block.start + i}. ` : "- ";
    const innerCols = Math.max(1, cols - marker.length);
    const itemRows = renderBlocks(item, innerCols);
    itemRows.forEach((r, j) => {
      const prefix = j === 0 ? marker : " ".repeat(marker.length);
      rows.push(r === "" && j !== 0 ? "" : `${prefix}${r}`);
    });
  });
  return rows;
}

/** Plain (unstyled-text) codepoint-width-aware wrap used for code-block lines, matching
 * `width.ts`'s `wrapText` behavior but kept local so this module has no dependency cycle back
 * through `render.ts`. */
function wrapPlainDim(text: string, cols: number): string[] {
  const width = Math.max(1, cols);
  if (text.length === 0) return [""];
  const out: string[] = [];
  let cur = "";
  let curWidth = 0;
  for (const cp of codePoints(text)) {
    const w = charWidth(cp);
    if (curWidth + w > width && cur.length > 0) {
      out.push(cur);
      cur = "";
      curWidth = 0;
    }
    cur += cp;
    curWidth += w;
  }
  out.push(cur);
  return out;
}

/** Block AST -> rows, with a blank separator row between top-level blocks (matching the
 * transcript's existing between-turn blank-line convention, applied here between Markdown
 * blocks within one turn). */
export function renderBlocks(blocks: BlockNode[], cols: number): string[] {
  const out: string[] = [];
  blocks.forEach((block, idx) => {
    if (idx > 0) out.push("");
    out.push(...renderBlock(block, cols));
  });
  return out;
}

/** Public entry point: a parsed Markdown AST -> plain rows carrying only allowlisted ANSI,
 * wrapped to `cols`. */
export function renderMarkdownRows(blocks: BlockNode[], cols: number): string[] {
  return renderBlocks(blocks, cols);
}
