import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../markdown/index.ts";
import { renderBlocks, renderMarkdownRows } from "./markdown-ansi.ts";

const RESET = "\x1b[0m";

/** Strip all ANSI SGR sequences, leaving only the plain visible text — used to assert on
 * content without hardcoding exact escape byte sequences in every test. */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching a real ESC byte is the point
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Every ANSI escape byte sequence appearing anywhere in `rows`, deduplicated — used to
 * assert the allowlist property: only ever SGR (`ESC [ ... m`) sequences, nothing else. */
function allEscapeSequences(rows: string[]): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching a real ESC byte is the point
    const matches = row.match(/\x1b\[[0-9;]*./g) ?? [];
    for (const m of matches) found.add(m);
  }
  return [...found];
}

describe("renderMarkdownRows — SGR allowlist", () => {
  test("every escape sequence emitted is a plain SGR (ESC [ ... m), never anything else", () => {
    const md =
      "# Heading\n\n**bold** *em* ~~strike~~ `code` [link](https://x.example)\n\n> quote\n\n- a\n- b\n\n```js\ncode\n```\n\n---";
    const rows = renderMarkdownRows(parseMarkdown(md), 40);
    for (const seq of allEscapeSequences(rows)) {
      expect(seq.endsWith("m")).toBe(true);
    }
  });

  test("never emits OSC, DCS, cursor-movement/erase, or DA/DSR sequences", () => {
    const md = "# H\n\n**bold**\n\n```\ncode\n```";
    const rows = renderMarkdownRows(parseMarkdown(md), 40);
    const joined = rows.join("\n");
    expect(joined).not.toContain("\x1b]"); // OSC
    expect(joined).not.toContain("\x1bP"); // DCS
    expect(joined).not.toContain("\x1b[?"); // private mode set/reset
    // Every CSI sequence present must be a plain SGR (ends in "m") — never a cursor-
    // movement/erase/DA/DSR final byte (A/B/C/D/H/J/K/f/c/n, etc).
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching a real ESC byte is the point
    const csiSequences = joined.match(/\x1b\[[0-9;]*./g) ?? [];
    for (const seq of csiSequences) {
      expect(seq.endsWith("m")).toBe(true);
    }
  });

  test("every styled row is reset-terminated", () => {
    const rows = renderMarkdownRows(parseMarkdown("**bold**"), 40);
    for (const row of rows) {
      if (row.includes("\x1b[")) {
        expect(row.endsWith(RESET)).toBe(true);
      }
    }
  });

  test("a plain unstyled row carries no escape bytes at all", () => {
    const rows = renderMarkdownRows(parseMarkdown("just plain text"), 40);
    expect(rows).toEqual(["just plain text"]);
  });
});

describe("renderMarkdownRows — visible content", () => {
  test("a paragraph renders as plain visible text", () => {
    const rows = renderMarkdownRows(parseMarkdown("hello world"), 40);
    expect(rows.map(stripAnsi)).toEqual(["hello world"]);
  });

  test("a heading is visibly present (bolded)", () => {
    const rows = renderMarkdownRows(parseMarkdown("# Title"), 40);
    expect(rows.map(stripAnsi).join("\n")).toContain("Title");
    expect(rows.some((r) => r.includes("\x1b[1"))).toBe(true);
  });

  test("an h2+ heading is styled distinctly from inline bold body text (DH-0065)", () => {
    const h2Rows = renderMarkdownRows(parseMarkdown("## Section"), 40);
    const boldRows = renderMarkdownRows(parseMarkdown("**Section**"), 40);
    expect(h2Rows[0]).not.toBe(boldRows[0]);
    expect(h2Rows[0]).toContain("36m"); // cyan code present, distinguishing it from plain bold
  });

  test("h1 keeps its own bold+underline treatment, distinct from an h2", () => {
    const h1Rows = renderMarkdownRows(parseMarkdown("# Title"), 40);
    const h2Rows = renderMarkdownRows(parseMarkdown("## Title"), 40);
    expect(h1Rows[0]).not.toBe(h2Rows[0]);
    expect(h1Rows[0]).toContain("\x1b[1;4m"); // bold+underline, only on h1
    expect(h2Rows[0]).not.toContain("4m");
  });

  test("strong/emphasis/strike/code text content survives stripping ANSI", () => {
    const rows = renderMarkdownRows(parseMarkdown("**bold** *em* ~~gone~~ `code`"), 80);
    const plain = rows.map(stripAnsi).join("\n");
    expect(plain).toContain("bold");
    expect(plain).toContain("em");
    expect(plain).toContain("gone");
    expect(plain).toContain("code");
  });

  test("a link shows both the link text and the URL (no OSC 8 hyperlink)", () => {
    const rows = renderMarkdownRows(parseMarkdown("[click here](https://example.com)"), 80);
    const plain = rows.map(stripAnsi).join("\n");
    expect(plain).toContain("click here");
    expect(plain).toContain("(https://example.com)");
  });

  test("a code block renders with a dim gutter and the literal code text", () => {
    const rows = renderMarkdownRows(parseMarkdown("```\nconst x = 1;\n```"), 80);
    const plain = rows.map(stripAnsi).join("\n");
    expect(plain).toContain("const x = 1;");
    expect(plain).toContain("│");
  });

  test("a blockquote is gutter-prefixed", () => {
    const rows = renderMarkdownRows(parseMarkdown("> quoted"), 80);
    const plain = rows.map(stripAnsi).join("\n");
    expect(plain).toContain("│");
    expect(plain).toContain("quoted");
  });

  test("an unordered list renders bullet markers", () => {
    const rows = renderMarkdownRows(parseMarkdown("- one\n- two"), 80);
    const plain = rows.map(stripAnsi);
    expect(plain.some((r) => r.startsWith("- one"))).toBe(true);
    expect(plain.some((r) => r.startsWith("- two"))).toBe(true);
  });

  test("an ordered list renders numeric markers with the correct start", () => {
    const rows = renderMarkdownRows(parseMarkdown("5. five\n6. six"), 80);
    const plain = rows.map(stripAnsi);
    expect(plain.some((r) => r.startsWith("5. five"))).toBe(true);
    expect(plain.some((r) => r.startsWith("6. six"))).toBe(true);
  });

  test("a list item with a blank line between two paragraphs keeps a bare blank row (no marker leaking onto it)", () => {
    const rows = renderMarkdownRows(parseMarkdown("- first para\n\n  second para"), 80);
    const plain = rows.map(stripAnsi);
    expect(plain).toContain("");
    expect(plain.some((r) => r.startsWith("- first para"))).toBe(true);
    expect(plain.some((r) => r.includes("second para"))).toBe(true);
  });

  test("a nested list indents continuation rows under their marker", () => {
    const rows = renderMarkdownRows(parseMarkdown("- outer\n  - inner"), 80);
    const plain = rows.map(stripAnsi);
    expect(plain.some((r) => r.includes("inner"))).toBe(true);
  });

  test("a thematic break renders as a horizontal rule of the requested width", () => {
    const rows = renderMarkdownRows(parseMarkdown("---"), 10);
    expect(stripAnsi(rows[0] as string)).toBe("─".repeat(10));
  });

  test("blank separator rows appear between top-level blocks", () => {
    const rows = renderMarkdownRows(parseMarkdown("first\n\nsecond"), 80);
    expect(rows).toContain("");
  });

  test("empty AST renders to no rows", () => {
    expect(renderMarkdownRows([], 40)).toEqual([]);
  });
});

describe("renderMarkdownRows — wrapping", () => {
  test("wraps long paragraph text to the given column width", () => {
    const rows = renderMarkdownRows(parseMarkdown("a".repeat(100)), 20);
    for (const row of rows) {
      expect(stripAnsi(row).length).toBeLessThanOrEqual(20);
    }
    expect(rows.length).toBeGreaterThan(1);
  });

  test("a wrapped continuation row of styled text re-opens the style and resets at the end", () => {
    const rows = renderMarkdownRows(parseMarkdown(`**${"bold ".repeat(20)}**`), 15);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      if (row.includes("\x1b[")) {
        expect(row.startsWith("\x1b[")).toBe(true);
        expect(row.endsWith(RESET)).toBe(true);
      }
    }
  });

  test("preserved paragraph line breaks produce separate wrapped rows", () => {
    const rows = renderMarkdownRows(parseMarkdown("line one\nline two"), 80);
    expect(rows.map(stripAnsi)).toEqual(["line one", "line two"]);
  });

  test("a code block line longer than the column width wraps too", () => {
    const rows = renderMarkdownRows(parseMarkdown(`\`\`\`\n${"x".repeat(50)}\n\`\`\``), 20);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("wide (CJK) characters in a paragraph wrap by visual width, not codepoint count", () => {
    const rows = renderMarkdownRows(parseMarkdown("中".repeat(20)), 10);
    for (const row of rows) {
      // Each row should be at most 10 visual columns (5 double-width chars).
      expect([...stripAnsi(row)].length).toBeLessThanOrEqual(5);
    }
  });

  test("wraps prose at word boundaries, not mid-word (DH-0065)", () => {
    const rows = renderMarkdownRows(parseMarkdown("hello world foo"), 7);
    expect(rows.map(stripAnsi)).toEqual(["hello", "world", "foo"]);
  });

  test("a trailing space that would overflow the row breaks before the next word", () => {
    // "abc" exactly fills width 3; the following space alone would overflow to 4, so the
    // break happens before it rather than emitting a dangling trailing space.
    const rows = renderMarkdownRows(parseMarkdown("abc def"), 3);
    expect(rows.map(stripAnsi)).toEqual(["abc", "def"]);
  });

  test("word-boundary wrapping still hard-breaks a single word wider than the row", () => {
    const rows = renderMarkdownRows(parseMarkdown("supercalifragilistic"), 6);
    expect(rows.map(stripAnsi)).toEqual(["superc", "alifra", "gilist", "ic"]);
  });

  test("word-boundary wrapping applies within a styled (bold) span too", () => {
    const rows = renderMarkdownRows(parseMarkdown("**hello world foo**"), 7);
    expect(rows.map(stripAnsi)).toEqual(["hello", "world", "foo"]);
  });

  test("a word right after a hard-broken word keeps its separating space (DH-0065 regression)", () => {
    // Regression: the hard-break branch's internal flushRow() left a stale "just wrapped"
    // flag that wrongly ate the next token's leading space, gluing words together
    // (e.g. "exercise" + "word" -> "exerciseword").
    const text =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa exercise word wrapping";
    const rows = renderMarkdownRows(parseMarkdown(text), 60);
    expect(rows.map(stripAnsi)).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "exercise word wrapping",
    ]);
  });

  test("a word right after an ordinary wrap-flush keeps its separating space (DH-0065 regression)", () => {
    // Regression: the same stale "just wrapped" flag leaked out of the plain (non-hard-break)
    // overflow flush too, gluing "bbb" and "cc" into "bbbcc".
    const rows = renderMarkdownRows(parseMarkdown("aaa bbb cc"), 5);
    expect(rows.map(stripAnsi)).toEqual(["aaa", "bbb", "cc"]);
  });
});

describe("renderMarkdownRows — style-bleed regression (DH-0065)", () => {
  test("a styled segment followed by plain text on the same line contains a reset between them, not only at end of row", () => {
    const rows = renderMarkdownRows(parseMarkdown("**bold** then plain"), 80);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string;
    // "bold" is styled, then " then plain" must not inherit that styling: there must be a
    // RESET emitted before " then plain" begins, not only the trailing end-of-row reset.
    const plainStart = row.indexOf(" then plain");
    expect(plainStart).toBeGreaterThan(-1);
    expect(row.slice(0, plainStart)).toContain(RESET);
    // And the plain tail itself must render with no active SGR state at all: strip every
    // SGR sequence and confirm the raw text before "then plain" is exactly what's expected,
    // i.e. nothing from "bold"'s style bled past its own closing reset.
    const resetBeforePlain = row.lastIndexOf(RESET, plainStart);
    expect(resetBeforePlain).toBeGreaterThan(-1);
    // No other SGR-opening sequence appears between that reset and the plain text start.
    const between = row.slice(resetBeforePlain + RESET.length, plainStart);
    expect(between).toBe("");
  });

  test("bold, then plain, then italic each get their own explicit reset — no cumulative bleed", () => {
    const rows = renderMarkdownRows(parseMarkdown("**bold** plain *em*"), 80);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string;
    const plain = stripAnsi(row);
    expect(plain).toBe("bold plain em");
    // A RESET must appear between the end of the styled "bold" text and the start of the
    // plain "plain" text — not only at the very end of the row.
    const boldEnd = row.indexOf("bold") + "bold".length;
    const plainIdx = row.indexOf("plain");
    expect(row.slice(boldEnd, plainIdx)).toContain(RESET);
  });

  test("a link's underline+blue styling does not bleed into the trailing paragraph text", () => {
    const rows = renderMarkdownRows(
      parseMarkdown("see [grafana](https://x.example) for details"),
      80,
    );
    const row = rows.join("\n");
    const linkEnd = row.indexOf("grafana") + "grafana".length;
    const forIdx = row.indexOf(" for details");
    expect(forIdx).toBeGreaterThan(-1);
    // Between the end of the styled link text ("grafana") and the trailing plain text
    // (" for details") there must be a reset — the underline/blue link style must not carry
    // through to it, whether via the link's own trailing "` (url)`" segment reset or one
    // emitted just before the plain tail.
    expect(row.slice(linkEnd, forIdx)).toContain(RESET);
  });

  test("plain text followed by a styled segment still opens style cleanly with no leaked reset text", () => {
    const rows = renderMarkdownRows(parseMarkdown("plain then **bold**"), 80);
    const plain = stripAnsi(rows.join("\n"));
    expect(plain).toBe("plain then bold");
  });
});

describe("renderBlocks (exported alias used internally for nested rendering)", () => {
  test("matches renderMarkdownRows for the same input", () => {
    const blocks = parseMarkdown("hello **world**");
    expect(renderBlocks(blocks, 40)).toEqual(renderMarkdownRows(blocks, 40));
  });
});
