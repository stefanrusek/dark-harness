// DH-0108: one shared fixture table exercising every Markdown construct dh's parser (this
// directory) supports, consumed by both `src/tui/markdown-ansi.test.ts` (the SGR-only ANSI
// renderer) and `src/web/client/markdown-dom.test.ts` (the sanitized DOM renderer). Each
// fixture pins the Markdown input plus a per-renderer assertion so a future change to either
// renderer that breaks a construct fails here immediately, traceable back to a single named
// row rather than scattered ad hoc.
//
// Deliberately *not* a `.test.ts` file: it exports data + assertion callbacks, it has no
// tests of its own to run. The `tui` callback is typed against plain `string[]`; the `web`
// callback is typed against `FixtureElement` below — a minimal structural subset of `Element`
// covering only what these assertions need — rather than `HTMLElement`, since this file lives
// under the root `src/` tsconfig (no `dom` lib; only `src/web/` opts into that), while still
// being satisfied by a real `HTMLElement` passed in from `src/web/client/markdown-dom.test.ts`.
// This keeps the module with no import dependency on `src/tui/` or `src/web/` — it only
// depends on the shared AST types, matching the ownership boundary in CLAUDE.md §3.

import { expect } from "bun:test";

/** Strips ANSI SGR sequences (`ESC [ ... m`), leaving only the plain visible text. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching a real ESC byte is the point
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Minimal structural subset of `Element`/`HTMLElement` used by the `web` fixture assertions
 * below — see the module header comment for why this isn't just `HTMLElement`. */
export interface FixtureElement {
  readonly textContent: string | null;
  readonly className: string;
  readonly children: ArrayLike<FixtureElement>;
  querySelector(selector: string): FixtureElement | null;
  querySelectorAll(selector: string): ArrayLike<FixtureElement> & Iterable<FixtureElement>;
  getAttribute(name: string): string | null;
}

export interface RenderingFixture {
  /** Construct name, used as the test title on both sides — keep unique and grep-able. */
  name: string;
  /** Markdown source fed to `parseMarkdown`. */
  markdown: string;
  /** Asserts the TUI ANSI rows (`renderMarkdownRows(parseMarkdown(markdown), cols)`). */
  tui: (rows: string[]) => void;
  /** Asserts the Web DOM shape rendered into a container (`renderMarkdownInto`). */
  web: (root: FixtureElement) => void;
}

const RESET = "\x1b[0m";
const BOLD = "1";
const ITALIC = "3";
const UNDERLINE = "4";
const STRIKE = "9";
const CYAN = "36";
const BLUE = "34";

export const renderingFixtures: RenderingFixture[] = [
  // --- Headings 1-6 -------------------------------------------------------------------
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    name: `heading h${level}`,
    markdown: `${"#".repeat(level)} Heading ${level}`,
    tui: (rows: string[]) => {
      expect(rows).toHaveLength(1);
      const row = rows[0] as string;
      expect(stripAnsi(row)).toBe(`Heading ${level}`);
      const codes = level === 1 ? [BOLD, UNDERLINE] : [BOLD, CYAN];
      expect(row.startsWith(`\x1b[${codes.join(";")}m`)).toBe(true);
      expect(row.endsWith(RESET)).toBe(true);
    },
    web: (root: FixtureElement) => {
      const heading = root.querySelector(`h${level}`);
      expect(heading).not.toBeNull();
      expect(heading?.textContent).toBe(`Heading ${level}`);
      expect(root.children).toHaveLength(1);
    },
  })),

  // --- Inline emphasis -----------------------------------------------------------------
  {
    name: "bold",
    markdown: "**bold**",
    tui: (rows) => {
      expect(rows).toEqual([`\x1b[${BOLD}mbold\x1b[0m`]);
    },
    web: (root) => {
      const strong = root.querySelector("p > strong");
      expect(strong?.textContent).toBe("bold");
    },
  },
  {
    name: "italic",
    markdown: "*em*",
    tui: (rows) => {
      expect(rows).toEqual([`\x1b[${ITALIC}mem\x1b[0m`]);
    },
    web: (root) => {
      const em = root.querySelector("p > em");
      expect(em?.textContent).toBe("em");
    },
  },
  {
    name: "strikethrough",
    markdown: "~~strike~~",
    tui: (rows) => {
      expect(rows).toEqual([`\x1b[${STRIKE}mstrike\x1b[0m`]);
    },
    web: (root) => {
      const del = root.querySelector("p > del");
      expect(del?.textContent).toBe("strike");
    },
  },
  {
    name: "inline code",
    markdown: "`code`",
    tui: (rows) => {
      expect(rows).toEqual([`\x1b[${CYAN}mcode\x1b[0m`]);
    },
    web: (root) => {
      const code = root.querySelector("p > code");
      expect(code?.textContent).toBe("code");
    },
  },

  // --- Fenced code blocks ---------------------------------------------------------------
  {
    name: "fenced code block without a language tag",
    markdown: "```\nplain\n```",
    tui: (rows) => {
      expect(rows).toEqual(["\x1b[2m│ plain\x1b[0m"]);
    },
    web: (root) => {
      const code = root.querySelector("pre > code");
      expect(code?.textContent).toBe("plain");
      expect(code?.className).toBe("");
    },
  },
  {
    name: "fenced code block with a language tag",
    markdown: "```ts\nconst x=1;\n```",
    tui: (rows) => {
      expect(rows).toEqual(["\x1b[2m│ const x=1;\x1b[0m"]);
    },
    web: (root) => {
      const code = root.querySelector("pre > code");
      expect(code?.textContent).toBe("const x=1;");
      expect(code?.className).toBe("language-ts");
    },
  },

  // --- Blockquotes ------------------------------------------------------------------------
  {
    name: "blockquote",
    markdown: "> quote",
    tui: (rows) => {
      expect(rows).toEqual(["\x1b[2m│\x1b[0m quote"]);
    },
    web: (root) => {
      const bq = root.querySelector("blockquote");
      expect(bq?.querySelector("p")?.textContent).toBe("quote");
    },
  },
  {
    name: "nested blockquote",
    markdown: "> outer\n> > inner",
    tui: (rows) => {
      expect(rows).toEqual([
        "\x1b[2m│\x1b[0m outer",
        "\x1b[2m│\x1b[0m ",
        "\x1b[2m│\x1b[0m \x1b[2m│\x1b[0m inner",
      ]);
    },
    web: (root) => {
      const outer = root.querySelector("blockquote");
      expect(outer?.querySelector(":scope > p")?.textContent).toBe("outer");
      const inner = outer?.querySelector("blockquote");
      expect(inner?.querySelector("p")?.textContent).toBe("inner");
    },
  },

  // --- Lists --------------------------------------------------------------------------
  {
    name: "unordered list",
    markdown: "- a\n- b",
    tui: (rows) => {
      expect(rows).toEqual(["- a", "- b"]);
    },
    web: (root) => {
      const ul = root.querySelector("ul");
      const items = ul ? [...ul.querySelectorAll(":scope > li")] : [];
      expect(items).toHaveLength(2);
      expect(items[0]?.textContent).toBe("a");
      expect(items[1]?.textContent).toBe("b");
    },
  },
  {
    name: "ordered list",
    markdown: "1. a\n2. b",
    tui: (rows) => {
      expect(rows).toEqual(["1. a", "2. b"]);
    },
    web: (root) => {
      const ol = root.querySelector("ol");
      const items = ol ? [...ol.querySelectorAll(":scope > li")] : [];
      expect(items).toHaveLength(2);
      expect(items[0]?.textContent).toBe("a");
      expect(items[1]?.textContent).toBe("b");
    },
  },
  {
    name: "nested unordered list",
    markdown: "- outer\n  - inner",
    tui: (rows) => {
      expect(rows).toEqual(["- outer", "", "  - inner"]);
    },
    web: (root) => {
      const outerLi = root.querySelector("ul > li");
      expect(outerLi?.querySelector(":scope > p")?.textContent).toBe("outer");
      const innerUl = outerLi?.querySelector("ul");
      expect(innerUl?.querySelector("li")?.textContent).toBe("inner");
    },
  },
  {
    name: "mixed nested list (ordered inside unordered)",
    markdown: "- outer\n  1. inner",
    tui: (rows) => {
      expect(rows).toEqual(["- outer", "", "  1. inner"]);
    },
    web: (root) => {
      const outerLi = root.querySelector("ul > li");
      expect(outerLi?.querySelector(":scope > p")?.textContent).toBe("outer");
      const innerOl = outerLi?.querySelector("ol");
      expect(innerOl?.querySelector("li")?.textContent).toBe("inner");
    },
  },

  // --- Links & thematic breaks -----------------------------------------------------------
  {
    name: "link",
    markdown: "[link](https://x.example)",
    tui: (rows) => {
      expect(rows).toEqual([`\x1b[${UNDERLINE};${BLUE}mlink\x1b[0m (https://x.example)\x1b[0m`]);
    },
    web: (root) => {
      const anchor = root.querySelector("a");
      expect(anchor?.textContent).toBe("link");
      expect(anchor?.getAttribute("href")).toBe("https://x.example/");
      expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(anchor?.getAttribute("target")).toBe("_blank");
    },
  },
  {
    name: "thematic break",
    markdown: "---",
    tui: (rows) => {
      expect(rows).toHaveLength(1);
      expect(stripAnsi(rows[0] as string)).toBe("─".repeat(80));
      expect(rows[0]).toBe(`\x1b[2m${"─".repeat(80)}\x1b[0m`);
    },
    web: (root) => {
      expect(root.querySelector("hr")).not.toBeNull();
    },
  },

  // --- Documented exclusions: must degrade to literal text, never crash -------------------
  {
    name: "excluded: tables degrade to literal text",
    markdown: "| a | b |\n| - | - |\n| 1 | 2 |",
    tui: (rows) => {
      const joined = stripAnsi(rows.join("\n"));
      expect(joined).toContain("| a | b |");
      expect(joined).toContain("| - | - |");
      expect(joined).toContain("| 1 | 2 |");
    },
    web: (root) => {
      expect(root.querySelector("table")).toBeNull();
      expect(root.textContent).toContain("| a | b |");
      expect(root.textContent).toContain("| 1 | 2 |");
    },
  },
  {
    name: "excluded: setext headings degrade to literal text",
    markdown: "Title\n===",
    tui: (rows) => {
      const joined = stripAnsi(rows.join("\n"));
      expect(joined).toContain("Title");
      expect(joined).toContain("===");
    },
    web: (root) => {
      expect(root.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
      expect(root.textContent).toContain("Title");
      expect(root.textContent).toContain("===");
    },
  },
  {
    name: "excluded: reference-style links degrade to literal text",
    markdown: "[text][ref]",
    tui: (rows) => {
      expect(stripAnsi(rows.join("\n"))).toBe("[text][ref]");
    },
    web: (root) => {
      expect(root.querySelector("a")).toBeNull();
      expect(root.textContent).toBe("[text][ref]");
    },
  },
];
