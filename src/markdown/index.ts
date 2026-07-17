// Shared "dh Markdown" parser (DH-0056). Zero dependencies, pure TypeScript, no Bun/DOM
// globals — this module is imported by both the TUI (compiled into the `dh` binary) and the
// Web client (bundled for the browser), so it must typecheck and run cleanly in both
// environments. Governance: this is shared wire-adjacent truth like `src/contracts/` —
// grammar/AST changes need architect sign-off (see CLAUDE.md §6.2), not a per-domain call.
//
// The subset parsed here (see tracking/DH-0056 D1) is deliberately smaller than CommonMark:
// paragraphs (embedded newlines preserved, not soft-wrap-joined), ATX headings, fenced code
// blocks (an unclosed fence at end-of-input is treated as closed — the "streaming rule"),
// nested unordered/ordered lists, blockquotes, thematic breaks, GFM tables, setext headings,
// reference-style links/images, and inline strong/emphasis/strike/code/links (images degrade
// to links, per DH-0109). Autolinks and footnotes remain intentionally unrecognized and
// therefore render as literal text — that's the "graceful degradation" functional
// requirement, not a bug.
//
// Raw HTML is always literal text: there is no HTML AST node type at all. That absence is
// the core security property this ticket exists for — a `<script>` tag in model output can
// never become markup in either client, because the AST has nothing that could render it as
// one.

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "emphasis"; children: InlineNode[] }
  | { kind: "strike"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; children: InlineNode[]; url: string };

export type TableAlign = "left" | "center" | "right" | null;

export type BlockNode =
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: "codeBlock"; info: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: BlockNode[][] }
  | { kind: "blockquote"; children: BlockNode[] }
  | { kind: "thematicBreak" }
  | { kind: "table"; align: TableAlign[]; header: InlineNode[][]; rows: InlineNode[][][] };

const ESC = "\x1b";

/**
 * Defensive control/escape strip (DH-0056 D5). Runs unconditionally as step zero of
 * `parseMarkdown` so a client can never forget or bypass it — the system-prompt instruction
 * (D6) is the primary defense, this is the guarantee when a model doesn't comply. Pure and
 * idempotent: running it twice produces the same output as running it once.
 *
 * Removes, in order:
 * 1. CRLF -> LF normalization; lone CR removed.
 * 2. Complete escape sequences introduced by ESC (0x1B): CSI (params 0x20-0x3F, final byte
 *    0x40-0x7E — this explicitly covers the DA/DSR forms `ESC[c`, `ESC[>c`, `ESC[5n`,
 *    `ESC[6n`, plus all cursor/erase/scroll-region/mode sequences), OSC (terminated by BEL or
 *    ST), DCS/SOS/PM/APC (terminated by ST), and any other two-byte `ESC x` sequence. A
 *    trailing/malformed ESC that heads no well-formed sequence is dropped alone (its tail
 *    renders as garbled-but-inert literal text).
 * 3. Remaining C0 controls (0x00-0x08, 0x0B-0x1F) and DEL (0x7F), keeping \n and \t.
 * 4. C1 codepoints U+0080-U+009F, treating the 8-bit sequence introducers (CSI U+009B, OSC
 *    U+009D, DCS U+0090) exactly like their ESC-prefixed forms (whole-sequence removal) since
 *    some terminals honor 8-bit C1 controls even in UTF-8 mode.
 */
export function sanitizeText(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "");
  let out = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i] as string;
    const code = ch.charCodeAt(0);

    if (ch === ESC) {
      const next = normalized[i + 1];
      if (next === "[") {
        const consumed = consumeCsiTail(normalized, i + 2);
        i = consumed === -1 ? i : consumed;
        continue;
      }
      if (next === "]") {
        const consumed = consumeOscTail(normalized, i + 2);
        i = consumed === -1 ? normalized.length : consumed;
        continue;
      }
      if (next === "P" || next === "X" || next === "^" || next === "_") {
        const consumed = consumeStTerminated(normalized, i + 2);
        i = consumed === -1 ? normalized.length : consumed;
        continue;
      }
      if (next !== undefined) {
        i = i + 1; // any other two-byte ESC sequence
        continue;
      }
      continue; // trailing lone ESC, dropped alone
    }

    if (code === 0x9b) {
      const consumed = consumeCsiTail(normalized, i + 1);
      i = consumed === -1 ? i : consumed;
      continue;
    }
    if (code === 0x9d) {
      const consumed = consumeOscTail(normalized, i + 1, true);
      i = consumed === -1 ? normalized.length : consumed;
      continue;
    }
    if (code === 0x90) {
      const consumed = consumeStTerminated(normalized, i + 1, true);
      i = consumed === -1 ? normalized.length : consumed;
      continue;
    }
    if (code >= 0x80 && code <= 0x9f) continue; // other bare C1 controls
    if (code <= 0x08 || (code >= 0x0b && code <= 0x1f)) continue; // C0 except \n \t
    if (code === 0x7f) continue; // DEL

    out += ch;
  }
  return out;
}

/** Scans CSI parameter/intermediate bytes (0x20-0x3F) starting at `start`, then one final
 * byte (0x40-0x7E). Returns the index of the final byte, or -1 if no well-formed final byte
 * is found before the string ends (caller then drops only the introducer). */
function consumeCsiTail(s: string, start: number): number {
  let j = start;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c >= 0x20 && c <= 0x3f) {
      j++;
      continue;
    }
    break;
  }
  if (j < s.length) {
    const c = s.charCodeAt(j);
    if (c >= 0x40 && c <= 0x7e) return j;
  }
  return -1;
}

/** Scans an OSC body starting at `start`, terminated by BEL (0x07, or 8-bit ST 0x9C when
 * `allowC1St`) or ST (`ESC \`). Returns the index of the terminator's last byte, or -1 if
 * unterminated (caller then drops to end of string). */
function consumeOscTail(s: string, start: number, allowC1St = false): number {
  let j = start;
  while (j < s.length) {
    const code = s.charCodeAt(j);
    if (code === 0x07) return j;
    if (allowC1St && code === 0x9c) return j;
    if (s[j] === ESC && s[j + 1] === "\\") return j + 1;
    j++;
  }
  return -1;
}

/** Scans a DCS/SOS/PM/APC body terminated by ST (`ESC \`, or the bare 0x9C C1 form when
 * `allowC1St`). Returns the index of the terminator's last byte, or -1 if unterminated. */
function consumeStTerminated(s: string, start: number, allowC1St = false): number {
  let j = start;
  while (j < s.length) {
    const code = s.charCodeAt(j);
    if (allowC1St && code === 0x9c) return j;
    if (s[j] === ESC && s[j + 1] === "\\") return j + 1;
    j++;
  }
  return -1;
}

// --- Block-level parsing -----------------------------------------------------------------

const ATX_RE = /^(#{1,6})(?:\s+(.*))?$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isThematicBreak(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  const ch = t[0] as string;
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  const stripped = t.replace(/\s+/g, "");
  if (stripped.length < 3) return false;
  return [...stripped].every((c) => c === ch);
}

function matchFence(line: string): { marker: string; info: string } | null {
  const m = /^(`{3,}|~{3,})(.*)$/.exec(line.trimStart());
  if (!m) return null;
  return { marker: m[1] as string, info: (m[2] as string).trim() };
}

function isClosingFence(line: string | undefined, marker: string): boolean {
  if (line === undefined) return false;
  const t = line.trim();
  const ch = marker[0] as string;
  return t.length >= marker.length && t.length > 0 && [...t].every((c) => c === ch);
}

function isBlockquoteLine(line: string): boolean {
  return /^ {0,3}>/.test(line);
}

function stripBlockquoteMarker(line: string): string {
  const m = /^ {0,3}> ?(.*)$/.exec(line);
  return m ? (m[1] as string) : line;
}

interface ListMarker {
  ordered: boolean;
  start: number;
  markerLength: number;
}

function matchListMarker(line: string): ListMarker | null {
  const unordered = /^( {0,3})([-*+])( +)(.*)$/.exec(line);
  if (unordered) {
    return {
      ordered: false,
      start: 1,
      markerLength:
        (unordered[1] as string).length +
        (unordered[2] as string).length +
        (unordered[3] as string).length,
    };
  }
  const ordered = /^( {0,3})(\d+)[.)]( +)(.*)$/.exec(line);
  if (ordered) {
    return {
      ordered: true,
      start: Number.parseInt(ordered[2] as string, 10),
      markerLength:
        (ordered[1] as string).length +
        (ordered[2] as string).length +
        1 +
        (ordered[3] as string).length,
    };
  }
  return null;
}

/** Setext heading underline (DH-0109): a line made up entirely of `=` (level 1) or entirely
 * of `-` (level 2), matched *after* the special-line checks fail so a genuine thematic break
 * (`---` on its own) keeps taking priority when there's no preceding paragraph text — setext
 * only wins when it directly follows in-progress paragraph lines, per the call site below. */
function matchSetextUnderline(line: string): 1 | 2 | null {
  const t = line.trim();
  if (t.length === 0) return null;
  if ([...t].every((c) => c === "=")) return 1;
  if ([...t].every((c) => c === "-")) return 2;
  return null;
}

/** Splits one GFM table row into raw cell strings: strips at most one leading/trailing pipe,
 * then splits on unescaped `|` (an escaped `\|` becomes a literal `|` within a cell). Returns
 * null if the line has no pipe at all (not table syntax). */
function splitTableRow(line: string): string[] | null {
  if (!line.includes("|")) return null;
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let j = 0; j < t.length; j++) {
    const c = t[j];
    if (c === "\\" && t[j + 1] === "|") {
      cur += "|";
      j++;
      continue;
    }
    if (c === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Matches a GFM table delimiter row (the `| --- | :---: |` line under the header), returning
 * one alignment per cell, or null if the line isn't a well-formed delimiter row. */
function matchTableDelimiterRow(line: string): TableAlign[] | null {
  if (!line.includes("-")) return null;
  const cells = splitTableRow(line);
  if (cells === null || cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return aligns;
}

/** Pads/truncates a row's cells to `count` columns — GFM: missing trailing cells are treated
 * as empty, extra cells are dropped. */
function normalizeRowLength<T>(cells: T[], count: number, empty: T): T[] {
  if (cells.length === count) return cells;
  if (cells.length > count) return cells.slice(0, count);
  return [...cells, ...Array(count - cells.length).fill(empty)];
}

function isSpecialLine(line: string): boolean {
  return (
    ATX_RE.test(line) ||
    isThematicBreak(line) ||
    matchFence(line) !== null ||
    isBlockquoteLine(line) ||
    matchListMarker(line) !== null
  );
}

function parseBlockLines(
  lines: string[],
  refs: Readonly<Record<string, string>> = {},
): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (isBlank(line)) {
      i++;
      continue;
    }

    if (isThematicBreak(line)) {
      blocks.push({ kind: "thematicBreak" });
      i++;
      continue;
    }

    const heading = ATX_RE.exec(line);
    if (heading) {
      const level = (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, children: parseInline(heading[2] ?? "", refs) });
      i++;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !isClosingFence(lines[i], fence.marker)) {
        codeLines.push(lines[i] as string);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence line, if one was found
      blocks.push({ kind: "codeBlock", info: fence.info, text: codeLines.join("\n") });
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && isBlockquoteLine(lines[i] as string)) {
        quoteLines.push(stripBlockquoteMarker(lines[i] as string));
        i++;
      }
      blocks.push({ kind: "blockquote", children: parseBlockLines(quoteLines, refs) });
      continue;
    }

    // GFM table (DH-0109): a row containing a pipe, immediately followed by a well-formed
    // delimiter row (`| --- | :---: |`), starts a table; the header row's cell count is the
    // column count every subsequent row/the delimiter row is normalized to.
    const headerCells = splitTableRow(line);
    const delimAlign =
      headerCells !== null && i + 1 < lines.length
        ? matchTableDelimiterRow(lines[i + 1] as string)
        : null;
    if (headerCells !== null && delimAlign !== null) {
      const columnCount = headerCells.length;
      const align = normalizeRowLength(delimAlign, columnCount, null as TableAlign);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && !isBlank(lines[i] as string)) {
        const rowCells = splitTableRow(lines[i] as string);
        if (rowCells === null) break;
        rows.push(normalizeRowLength(rowCells, columnCount, "").map((c) => parseInline(c, refs)));
        i++;
      }
      blocks.push({
        kind: "table",
        align,
        header: headerCells.map((c) => parseInline(c, refs)),
        rows,
      });
      continue;
    }

    const marker = matchListMarker(line);
    if (marker) {
      const ordered = marker.ordered;
      const start = marker.start;
      const items: BlockNode[][] = [];
      while (i < lines.length) {
        const m = matchListMarker(lines[i] as string);
        if (!m || m.ordered !== ordered) break;
        const markerLength = m.markerLength;
        const pad = " ".repeat(markerLength);
        const itemLines: string[] = [(lines[i] as string).slice(markerLength)];
        i++;
        while (i < lines.length) {
          const current = lines[i] as string;
          if (isBlank(current)) {
            const lookahead = lines[i + 1];
            if (lookahead?.startsWith(pad)) {
              itemLines.push("");
              i++;
              continue;
            }
            break;
          }
          if (current.startsWith(pad)) {
            itemLines.push(current.slice(markerLength));
            i++;
            continue;
          }
          break;
        }
        items.push(parseBlockLines(itemLines, refs));
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !isBlank(lines[i] as string) &&
      !isSpecialLine(lines[i] as string) &&
      matchSetextUnderline(lines[i] as string) === null
    ) {
      paraLines.push(lines[i] as string);
      i++;
    }
    // Setext heading (DH-0109): an underline of `=`/`-` directly beneath the paragraph lines
    // just collected converts them into an h1/h2, taking priority over `-`'s usual thematic-
    // break reading in this position (matching CommonMark's own precedence rule).
    const setextLevel = i < lines.length ? matchSetextUnderline(lines[i] as string) : null;
    if (setextLevel !== null) {
      blocks.push({
        kind: "heading",
        level: setextLevel,
        children: parseInline(paraLines.join(" "), refs),
      });
      i++;
      continue;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paraLines.join("\n"), refs) });
  }

  return blocks;
}

// --- Inline parsing ------------------------------------------------------------------------

function findMatchingBracket(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === "[") depth++;
    else if (text[j] === "]") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

interface ParsedLink {
  label: string;
  url: string;
  end: number;
}

/** `text[at]` must be `"["`. Parses `[label](url)`, returning null if the syntax doesn't
 * fully resolve (falls back to literal text at the call site). */
function parseLinkLike(text: string, at: number): ParsedLink | null {
  const closeBracket = findMatchingBracket(text, at);
  if (closeBracket === -1) return null;
  if (text[closeBracket + 1] !== "(") return null;
  const closeParen = text.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  return {
    label: text.slice(at + 1, closeBracket),
    url: text.slice(closeBracket + 2, closeParen).trim(),
    end: closeParen + 1,
  };
}

/** `text[at]` must be `"["`. Parses a reference-style link/image `[label][ref]` or the
 * collapsed form `[label][]` (which reuses `label` as the ref key), resolving `ref` against
 * `refs` (lowercased, trimmed keys, per the definitions `parseMarkdown` extracts up front).
 * Returns null if the bracket structure doesn't parse or the ref has no definition — the call
 * site then falls back to literal text, same as an unresolved inline link. */
function parseReferenceLink(
  text: string,
  at: number,
  refs: Readonly<Record<string, string>>,
): ParsedLink | null {
  const closeBracket = findMatchingBracket(text, at);
  if (closeBracket === -1) return null;
  const label = text.slice(at + 1, closeBracket);
  let refLabel = label;
  let end = closeBracket + 1;
  if (text[closeBracket + 1] === "[") {
    const closeRef = findMatchingBracket(text, closeBracket + 1);
    if (closeRef === -1) return null;
    const refText = text.slice(closeBracket + 2, closeRef);
    if (refText !== "") refLabel = refText;
    end = closeRef + 1;
  }
  const url = refs[refLabel.trim().toLowerCase()];
  if (url === undefined) return null;
  return { label, url, end };
}

export function parseInline(
  text: string,
  refs: Readonly<Record<string, string>> = {},
): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf) {
      nodes.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    if (text[i] === "!" && text[i + 1] === "[") {
      const link = parseLinkLike(text, i + 1) ?? parseReferenceLink(text, i + 1, refs);
      if (link) {
        flush();
        // Images degrade to links: alt text becomes the visible link text (D1).
        nodes.push({ kind: "link", children: [{ kind: "text", text: link.label }], url: link.url });
        i = link.end;
        continue;
      }
    }

    if (text[i] === "[") {
      const link = parseLinkLike(text, i) ?? parseReferenceLink(text, i, refs);
      if (link) {
        flush();
        nodes.push({ kind: "link", children: parseInline(link.label, refs), url: link.url });
        i = link.end;
        continue;
      }
    }

    if (rest.startsWith("``")) {
      const close = text.indexOf("``", i + 2);
      if (close !== -1) {
        flush();
        let code = text.slice(i + 2, close);
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim().length > 0) {
          code = code.slice(1, -1);
        }
        nodes.push({ kind: "code", text: code });
        i = close + 2;
        continue;
      }
    }

    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (rest.startsWith("**") || rest.startsWith("__")) {
      const delim = rest.slice(0, 2);
      const close = text.indexOf(delim, i + 2);
      if (close !== -1) {
        flush();
        nodes.push({ kind: "strong", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (rest.startsWith("~~")) {
      const close = text.indexOf("~~", i + 2);
      if (close !== -1) {
        flush();
        nodes.push({ kind: "strike", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (text[i] === "*" || text[i] === "_") {
      const delim = text[i] as string;
      // Skip past any candidate that's actually one end of a doubled `**`/`__` delimiter
      // (already handled above) rather than a genuine single-delimiter close — otherwise
      // `*em **bold** more*` would close the outer emphasis at the first `*` of `**bold**`
      // instead of at the final `*`.
      let close = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === delim && text[j + 1] !== delim && text[j - 1] !== delim) {
          close = j;
          break;
        }
      }
      if (close !== -1 && close > i + 1) {
        flush();
        nodes.push({ kind: "emphasis", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    buf += text[i];
    i++;
  }

  flush();
  return nodes;
}

const REF_DEFINITION_RE = /^ {0,3}\[([^\]]+)\]:\s*(\S+)\s*$/;

/** Scans for GFM reference definitions (`[ref]: url`, one per line, at most 3 leading spaces)
 * and pulls them out of the line stream — they're metadata, not their own paragraph — into a
 * lowercased-label -> url map consumed by `parseInline`'s reference-link resolution. A matched
 * definition line is blanked out in place (not spliced) so every other line's index is
 * unaffected. */
function extractReferenceDefinitions(lines: string[]): {
  refs: Record<string, string>;
  lines: string[];
} {
  const refs: Record<string, string> = {};
  const out = lines.map((line) => {
    const m = REF_DEFINITION_RE.exec(line);
    if (!m) return line;
    const label = (m[1] as string).trim().toLowerCase();
    if (!(label in refs)) refs[label] = m[2] as string;
    return "";
  });
  return { refs, lines: out };
}

/** Parse dh Markdown. Applies {@link sanitizeText} unconditionally as step zero — a client
 * cannot forget the defensive fallback because it cannot bypass it. */
export function parseMarkdown(raw: string): BlockNode[] {
  const sanitized = sanitizeText(raw);
  const { refs, lines } = extractReferenceDefinitions(sanitized.split("\n"));
  return parseBlockLines(lines, refs);
}
