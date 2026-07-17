import { describe, expect, test } from "bun:test";
import { type BlockNode, parseInline, parseMarkdown, sanitizeText } from "./index.ts";

describe("sanitizeText", () => {
  test("is a no-op on plain text", () => {
    expect(sanitizeText("hello world")).toBe("hello world");
  });

  test("normalizes CRLF to LF", () => {
    expect(sanitizeText("a\r\nb")).toBe("a\nb");
  });

  test("removes a lone CR", () => {
    expect(sanitizeText("a\rb")).toBe("ab");
  });

  test("keeps \\n and \\t", () => {
    expect(sanitizeText("a\nb\tc")).toBe("a\nb\tc");
  });

  test("strips other C0 controls", () => {
    expect(sanitizeText("a\x00b\x01c\x1fd")).toBe("abcd");
  });

  test("strips DEL", () => {
    expect(sanitizeText("a\x7fb")).toBe("ab");
  });

  test("strips a complete CSI cursor-movement sequence", () => {
    expect(sanitizeText("a\x1b[2Ab")).toBe("ab");
  });

  test("strips the DA request forms explicitly flagged by DH-0025", () => {
    expect(sanitizeText("\x1b[c")).toBe("");
    expect(sanitizeText("\x1b[0c")).toBe("");
    expect(sanitizeText("\x1b[>c")).toBe("");
  });

  test("strips the DSR request forms explicitly flagged by DH-0025", () => {
    expect(sanitizeText("\x1b[5n")).toBe("");
    expect(sanitizeText("\x1b[6n")).toBe("");
  });

  test("strips an OSC sequence terminated by BEL (e.g. OSC 52 clipboard write)", () => {
    expect(sanitizeText("a\x1b]52;c;payload\x07b")).toBe("ab");
  });

  test("strips an OSC sequence terminated by ST (ESC \\\\)", () => {
    expect(sanitizeText("a\x1b]0;title\x1b\\b")).toBe("ab");
  });

  test("strips a DCS sequence terminated by ST", () => {
    expect(sanitizeText("a\x1bPsome-dcs-payload\x1b\\b")).toBe("ab");
  });

  test("strips SOS/PM/APC introducers", () => {
    expect(sanitizeText("a\x1bXfoo\x1b\\b")).toBe("ab");
    expect(sanitizeText("a\x1b^foo\x1b\\b")).toBe("ab");
    expect(sanitizeText("a\x1b_foo\x1b\\b")).toBe("ab");
  });

  test("drops any other two-byte ESC sequence", () => {
    expect(sanitizeText("a\x1bZb")).toBe("ab");
  });

  test("drops a trailing lone ESC with nothing after it", () => {
    expect(sanitizeText("abc\x1b")).toBe("abc");
  });

  test("an unterminated CSI drops only the introducer, tail renders as literal text", () => {
    // ESC [ with params but no final byte before EOF.
    expect(sanitizeText("a\x1b[1;2")).toBe("a[1;2");
  });

  test("an unterminated OSC is dropped to end of string", () => {
    expect(sanitizeText("a\x1b]52;never-closed")).toBe("a");
  });

  test("an unterminated DCS is dropped to end of string", () => {
    expect(sanitizeText("a\x1bPnever-closed")).toBe("a");
  });

  test("strips bare 8-bit C1 CSI (U+009B)", () => {
    expect(sanitizeText("a2Ab")).toBe("ab");
  });

  test("strips bare 8-bit C1 OSC (U+009D) terminated by 8-bit ST (U+009C)", () => {
    expect(sanitizeText("a0;titleb")).toBe("ab");
  });

  test("strips bare 8-bit C1 OSC terminated by BEL", () => {
    expect(sanitizeText("a0;title\x07b")).toBe("ab");
  });

  test("strips bare 8-bit C1 OSC terminated by ESC \\\\", () => {
    expect(sanitizeText("a0;title\x1b\\b")).toBe("ab");
  });

  test("an unterminated bare 8-bit C1 OSC is dropped to end of string", () => {
    expect(sanitizeText("anever-closed")).toBe("a");
  });

  test("strips bare 8-bit C1 DCS (U+0090) terminated by 8-bit ST", () => {
    expect(sanitizeText("apayloadb")).toBe("ab");
  });

  test("strips bare 8-bit C1 DCS terminated by ESC \\\\", () => {
    expect(sanitizeText("apayload\x1b\\b")).toBe("ab");
  });

  test("an unterminated bare 8-bit C1 DCS is dropped to end of string", () => {
    expect(sanitizeText("anever-closed")).toBe("a");
  });

  test("an unterminated bare 8-bit CSI (no final byte) drops only the introducer", () => {
    expect(sanitizeText("a1;2")).toBe("a1;2");
  });

  test("drops other bare C1 controls not otherwise recognized", () => {
    expect(sanitizeText("ab")).toBe("ab");
  });

  test("is idempotent", () => {
    const raw = "a\x1b[2Ab\x00c\r\nd";
    const once = sanitizeText(raw);
    expect(sanitizeText(once)).toBe(once);
  });
});

describe("parseMarkdown — block structure", () => {
  test("a plain paragraph", () => {
    expect(parseMarkdown("hello world")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "hello world" }] },
    ]);
  });

  test("multiple paragraphs separated by a blank line", () => {
    const blocks = parseMarkdown("first\n\nsecond");
    expect(blocks).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "first" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "second" }] },
    ]);
  });

  test("a paragraph preserves embedded single newlines as literal breaks", () => {
    const blocks = parseMarkdown("line one\nline two");
    expect(blocks).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "line one\nline two" }] },
    ]);
  });

  test("ATX headings level 1-6", () => {
    for (let level = 1; level <= 6; level++) {
      const hashes = "#".repeat(level);
      const blocks = parseMarkdown(`${hashes} Title`);
      expect(blocks).toEqual([
        {
          kind: "heading",
          level: level as 1 | 2 | 3 | 4 | 5 | 6,
          children: [{ kind: "text", text: "Title" }],
        },
      ]);
    }
  });

  test("a heading with no text after the hashes", () => {
    expect(parseMarkdown("###")).toEqual([{ kind: "heading", level: 3, children: [] }]);
  });

  test("7 hashes is not a heading (falls back to a paragraph)", () => {
    const blocks = parseMarkdown("####### not a heading");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  test("a fenced code block with an info string", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1;\n```");
    expect(blocks).toEqual([{ kind: "codeBlock", info: "ts", text: "const x = 1;" }]);
  });

  test("a tilde-fenced code block", () => {
    const blocks = parseMarkdown("~~~\nhello\n~~~");
    expect(blocks).toEqual([{ kind: "codeBlock", info: "", text: "hello" }]);
  });

  test("an unclosed fence at end-of-input is treated as closed (streaming rule)", () => {
    const blocks = parseMarkdown("```js\nconst partial = ");
    expect(blocks).toEqual([{ kind: "codeBlock", info: "js", text: "const partial = " }]);
  });

  test("an empty fenced code block", () => {
    expect(parseMarkdown("```\n```")).toEqual([{ kind: "codeBlock", info: "", text: "" }]);
  });

  test("a thematic break: ---, ***, ___", () => {
    expect(parseMarkdown("---")).toEqual([{ kind: "thematicBreak" }]);
    expect(parseMarkdown("***")).toEqual([{ kind: "thematicBreak" }]);
    expect(parseMarkdown("___")).toEqual([{ kind: "thematicBreak" }]);
    expect(parseMarkdown("- - -")).toEqual([{ kind: "thematicBreak" }]);
  });

  test("a blockquote", () => {
    const blocks = parseMarkdown("> quoted text");
    expect(blocks).toEqual([
      {
        kind: "blockquote",
        children: [{ kind: "paragraph", children: [{ kind: "text", text: "quoted text" }] }],
      },
    ]);
  });

  test("a nested blockquote", () => {
    const blocks = parseMarkdown("> outer\n> > inner");
    expect(blocks).toEqual([
      {
        kind: "blockquote",
        children: [
          { kind: "paragraph", children: [{ kind: "text", text: "outer" }] },
          {
            kind: "blockquote",
            children: [{ kind: "paragraph", children: [{ kind: "text", text: "inner" }] }],
          },
        ],
      },
    ]);
  });

  test("an unordered list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [{ kind: "paragraph", children: [{ kind: "text", text: "one" }] }],
          [{ kind: "paragraph", children: [{ kind: "text", text: "two" }] }],
          [{ kind: "paragraph", children: [{ kind: "text", text: "three" }] }],
        ],
      },
    ]);
  });

  test("unordered list markers -, *, and + all work", () => {
    expect(parseMarkdown("* item")).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [[{ kind: "paragraph", children: [{ kind: "text", text: "item" }] }]],
      },
    ]);
    expect(parseMarkdown("+ item")).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [[{ kind: "paragraph", children: [{ kind: "text", text: "item" }] }]],
      },
    ]);
  });

  test("an ordered list, preserving the starting number", () => {
    const blocks = parseMarkdown("5. five\n6. six");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: true,
        start: 5,
        items: [
          [{ kind: "paragraph", children: [{ kind: "text", text: "five" }] }],
          [{ kind: "paragraph", children: [{ kind: "text", text: "six" }] }],
        ],
      },
    ]);
  });

  test("an ordered list using ')' delimiters", () => {
    const blocks = parseMarkdown("1) one");
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: true, start: 1 });
  });

  test("a list stops mixing ordered/unordered types into one list", () => {
    const blocks = parseMarkdown("- bullet\n1. numbered");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });

  test("a nested list via indentation", () => {
    const blocks = parseMarkdown("- outer\n  - inner");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [
            { kind: "paragraph", children: [{ kind: "text", text: "outer" }] },
            {
              kind: "list",
              ordered: false,
              start: 1,
              items: [[{ kind: "paragraph", children: [{ kind: "text", text: "inner" }] }]],
            },
          ],
        ],
      },
    ]);
  });

  test("a list item containing a nested code fence", () => {
    const blocks = parseMarkdown("- item\n  ```\n  code\n  ```");
    const list = blocks[0] as Extract<BlockNode, { kind: "list" }>;
    expect(list.items[0]).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "item" }] },
      { kind: "codeBlock", info: "", text: "code" },
    ]);
  });

  test("a list item can span a blank line when the continuation is indented", () => {
    const blocks = parseMarkdown("- item one\n\n  still item one\n- item two");
    const list = blocks[0] as Extract<BlockNode, { kind: "list" }>;
    expect(list.items).toHaveLength(2);
  });

  test("a blank line not followed by indented content ends the list item cleanly", () => {
    const blocks = parseMarkdown("- item one\n\nnot part of the list");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list" });
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      children: [{ kind: "text", text: "not part of the list" }],
    });
  });

  test("GFM tables parse to a table node (DH-0109)", () => {
    const blocks = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(blocks).toEqual([
      {
        kind: "table",
        align: [null, null],
        header: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]],
        rows: [[[{ kind: "text", text: "1" }], [{ kind: "text", text: "2" }]]],
      },
    ]);
  });

  test("GFM table alignment markers (DH-0109)", () => {
    const blocks = parseMarkdown("| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |");
    expect(blocks).toEqual([
      expect.objectContaining({ kind: "table", align: ["left", "center", "right"] }),
    ]);
  });

  test("a bare pipe-containing line without a delimiter row is not a table", () => {
    const blocks = parseMarkdown("a | b");
    expect(blocks).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "a | b" }] }]);
  });

  test("an escaped pipe stays a literal `|` within a table cell", () => {
    const blocks = parseMarkdown("| a | b |\n| - | - |\n| x\\|y | z |");
    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "table",
        rows: [[[{ kind: "text", text: "x|y" }], [{ kind: "text", text: "z" }]]],
      }),
    ]);
  });

  test("a table row with fewer cells than the header is padded with empty cells", () => {
    const blocks = parseMarkdown("| a | b | c |\n| - | - | - |\n| 1 |");
    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "table",
        rows: [[[{ kind: "text", text: "1" }], [], []]],
      }),
    ]);
  });

  test("a table row with more cells than the header has the extras dropped", () => {
    const blocks = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 | 3 |");
    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "table",
        rows: [[[{ kind: "text", text: "1" }], [{ kind: "text", text: "2" }]]],
      }),
    ]);
  });

  test("raw HTML in a paragraph renders as literal text, never a markup node", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "<script>alert(1)</script>" }] },
    ]);
  });

  test("setext-style headings parse as h1/h2 (DH-0109)", () => {
    expect(parseMarkdown("Title\n===")).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "Title" }] },
    ]);
    expect(parseMarkdown("Subtitle\n---")).toEqual([
      { kind: "heading", level: 2, children: [{ kind: "text", text: "Subtitle" }] },
    ]);
  });

  test("a standalone thematic break with no preceding paragraph stays a thematic break", () => {
    expect(parseMarkdown("---")).toEqual([{ kind: "thematicBreak" }]);
  });

  test("reference-style links resolve against a definition anywhere in the input (DH-0109)", () => {
    const blocks = parseMarkdown("[text][ref]\n\n[ref]: https://example.com");
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "link", children: [{ kind: "text", text: "text" }], url: "https://example.com" },
        ],
      },
    ]);
  });

  test("collapsed reference-style links ([label][]) reuse the label as the ref key", () => {
    const blocks = parseMarkdown("[ref][]\n\n[ref]: https://example.com");
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "link", children: [{ kind: "text", text: "ref" }], url: "https://example.com" },
        ],
      },
    ]);
  });

  test("an unresolved reference-style link stays literal text", () => {
    expect(parseMarkdown("[text][missing]")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "[text][missing]" }] },
    ]);
  });

  test("empty input parses to no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  test("only-whitespace input parses to no blocks", () => {
    expect(parseMarkdown("   \n\t\n")).toEqual([]);
  });

  test("sanitizeText runs unconditionally as step zero", () => {
    const blocks = parseMarkdown("hello\x1b[31m world");
    expect(blocks).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "hello world" }] },
    ]);
  });
});

describe("parseInline", () => {
  test("plain text", () => {
    expect(parseInline("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("strong with **", () => {
    expect(parseInline("**bold**")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
    ]);
  });

  test("strong with __", () => {
    expect(parseInline("__bold__")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
    ]);
  });

  test("emphasis with *", () => {
    expect(parseInline("*em*")).toEqual([
      { kind: "emphasis", children: [{ kind: "text", text: "em" }] },
    ]);
  });

  test("emphasis with _", () => {
    expect(parseInline("_em_")).toEqual([
      { kind: "emphasis", children: [{ kind: "text", text: "em" }] },
    ]);
  });

  test("strikethrough", () => {
    expect(parseInline("~~gone~~")).toEqual([
      { kind: "strike", children: [{ kind: "text", text: "gone" }] },
    ]);
  });

  test("an unterminated ~~ falls back to literal text", () => {
    expect(parseInline("~~oops")).toEqual([{ kind: "text", text: "~~oops" }]);
  });

  test("inline code with a single backtick", () => {
    expect(parseInline("`code`")).toEqual([{ kind: "code", text: "code" }]);
  });

  test("inline code containing a literal backtick, via the double-backtick form", () => {
    expect(parseInline("`` a`b ``")).toEqual([{ kind: "code", text: "a`b" }]);
  });

  test("formatting is not parsed inside a code span", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ kind: "code", text: "**not bold**" }]);
  });

  test("a link", () => {
    expect(parseInline("[text](https://example.com)")).toEqual([
      { kind: "link", children: [{ kind: "text", text: "text" }], url: "https://example.com" },
    ]);
  });

  test("a link label can contain further inline formatting", () => {
    expect(parseInline("[**bold** text](https://example.com)")).toEqual([
      {
        kind: "link",
        children: [
          { kind: "strong", children: [{ kind: "text", text: "bold" }] },
          { kind: "text", text: " text" },
        ],
        url: "https://example.com",
      },
    ]);
  });

  test("an image degrades to a link with the alt text as the link text", () => {
    expect(parseInline("![alt text](https://example.com/x.png)")).toEqual([
      {
        kind: "link",
        children: [{ kind: "text", text: "alt text" }],
        url: "https://example.com/x.png",
      },
    ]);
  });

  test("a malformed image (unterminated) falls back to literal text", () => {
    expect(parseInline("![alt](unterminated")).toEqual([
      { kind: "text", text: "![alt](unterminated" },
    ]);
  });

  test("an unterminated double-backtick code span degrades without throwing", () => {
    // The immediately-following single backtick is picked up by the single-backtick-code
    // fallback path — an empty code span plus literal "oops" — rather than the whole thing
    // staying literal; either is an acceptable "doesn't crash, doesn't fabricate HTML/ANSI"
    // degradation, so this only pins down that it doesn't throw and the text isn't lost.
    const nodes = parseInline("``oops");
    expect(JSON.stringify(nodes)).toContain("oops");
  });

  test("nested strong-in-emphasis", () => {
    expect(parseInline("*em **bold** more*")).toEqual([
      {
        kind: "emphasis",
        children: [
          { kind: "text", text: "em " },
          { kind: "strong", children: [{ kind: "text", text: "bold" }] },
          { kind: "text", text: " more" },
        ],
      },
    ]);
  });

  test("an unterminated ** falls back to literal text", () => {
    expect(parseInline("**oops")).toEqual([{ kind: "text", text: "**oops" }]);
  });

  test("an unterminated single backtick falls back to literal text", () => {
    expect(parseInline("`oops")).toEqual([{ kind: "text", text: "`oops" }]);
  });

  test("an unmatched [ with no closing bracket falls back to literal text", () => {
    expect(parseInline("[oops")).toEqual([{ kind: "text", text: "[oops" }]);
  });

  test("a [label] with no following ( is not a link", () => {
    expect(parseInline("[oops] not a link")).toEqual([{ kind: "text", text: "[oops] not a link" }]);
  });

  test("a [label]( with no closing ) is not a link", () => {
    expect(parseInline("[oops](never closed")).toEqual([
      { kind: "text", text: "[oops](never closed" },
    ]);
  });

  test("reference-style links degrade to literal text", () => {
    expect(parseInline("[text][ref]")).toEqual([{ kind: "text", text: "[text][ref]" }]);
  });

  test("autolinks degrade to literal text", () => {
    expect(parseInline("<https://example.com>")).toEqual([
      { kind: "text", text: "<https://example.com>" },
    ]);
  });

  test("a single asterisk with no closing partner is literal", () => {
    expect(parseInline("a * b")).toEqual([{ kind: "text", text: "a * b" }]);
  });

  test("nested brackets in a link label are matched correctly", () => {
    expect(parseInline("[a [nested] b](url)")).toEqual([
      {
        kind: "link",
        children: [{ kind: "text", text: "a [nested] b" }],
        url: "url",
      },
    ]);
  });

  test("empty input", () => {
    expect(parseInline("")).toEqual([]);
  });
});
