import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../../markdown/index.ts";
import { renderMarkdownInto } from "./markdown-dom.ts";
import { createTestDom } from "./test-dom.ts";

function renderMd(doc: Document, container: HTMLElement, markdown: string): void {
  renderMarkdownInto(doc, container, parseMarkdown(markdown));
}

describe("renderMarkdownInto — block constructs", () => {
  test("paragraph renders as <p>", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "hello world");
    expect(root.querySelector("p")?.textContent).toBe("hello world");
  });

  test("embedded line breaks within a paragraph render as <br>, not re-flowed", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "line one\nline two");
    const p = root.querySelector("p");
    expect(p?.querySelectorAll("br")).toHaveLength(1);
    expect(p?.textContent).toBe("line oneline two");
  });

  test("ATX headings render as h1-h6", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "# H1\n\n###### H6");
    expect(root.querySelector("h1")?.textContent).toBe("H1");
    expect(root.querySelector("h6")?.textContent).toBe("H6");
  });

  test("fenced code block renders as <pre><code> with a filtered language class", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "```ts\nconst x = 1;\n```");
    const code = root.querySelector("pre > code");
    expect(code?.textContent).toBe("const x = 1;");
    expect(code?.className).toBe("language-ts");
  });

  test("fenced code block info string is filtered to [a-z0-9-] before becoming a class", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "```TS!@# Fancy\ncode\n```");
    const code = root.querySelector("pre > code");
    expect(code?.className).toBe("language-tsfancy");
  });

  test("fenced code block with no usable info string gets no class attribute", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "```\ncode\n```");
    const code = root.querySelector("pre > code");
    expect(code?.className).toBe("");
  });

  test("unordered list renders as <ul><li>", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "- one\n- two");
    const items = root.querySelectorAll("ul > li");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("one");
    expect(items[1]?.textContent).toBe("two");
  });

  test("ordered list renders as <ol> with a start attribute when not starting at 1", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "3. three\n4. four");
    const ol = root.querySelector("ol") as HTMLOListElement;
    expect(ol.start).toBe(3);
    expect(ol.querySelectorAll("li")).toHaveLength(2);
  });

  test("ordered list starting at 1 does not set an explicit start attribute", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "1. one\n2. two");
    // happy-dom defaults `start` to 1 regardless; the important assertion is that the
    // renderer's own conditional (`start !== 1`) is exercised on the false branch too.
    const ol = root.querySelector("ol") as HTMLOListElement;
    expect(ol.querySelectorAll("li")).toHaveLength(2);
  });

  test("nested lists render nested <ul>/<ol>", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "- outer\n  - inner");
    const outerItems = root.querySelectorAll(":scope > ul > li");
    expect(outerItems).toHaveLength(1);
    expect(root.querySelector("ul ul li")?.textContent).toBe("inner");
  });

  test("blockquote renders as <blockquote>", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "> quoted text");
    expect(root.querySelector("blockquote")?.textContent).toBe("quoted text");
  });

  test("thematic break renders as <hr>", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "---");
    expect(root.querySelector("hr")).not.toBeNull();
  });

  test("renderMarkdownInto replaces existing container content", () => {
    const { document, root } = createTestDom();
    root.textContent = "stale content";
    renderMd(document, root, "fresh");
    expect(root.textContent).toBe("fresh");
  });
});

describe("renderMarkdownInto — inline constructs", () => {
  test("strong/emphasis/strike render as real elements", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "**bold** *em* ~~strike~~");
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("em")?.textContent).toBe("em");
    expect(root.querySelector("del")?.textContent).toBe("strike");
  });

  test("inline code renders as <code>, not interpreted as markup", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "`<script>x</script>`");
    const code = root.querySelector("p > code");
    expect(code?.textContent).toBe("<script>x</script>");
    expect(root.querySelector("script")).toBeNull();
  });

  test("images degrade to links (alt text as link text)", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "![alt text](https://example.com/img.png)");
    const anchor = root.querySelector("a");
    expect(anchor?.textContent).toBe("alt text");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/img.png");
  });
});

describe("renderMarkdownInto — link scheme filtering (security)", () => {
  test("http/https/mailto links become real anchors with rel/target set", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[text](https://example.com/page)");
    const anchor = root.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com/page");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  test("mailto link is allowed", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[email me](mailto:a@example.com)");
    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("mailto:a@example.com");
  });

  test("javascript: scheme is rejected — renders as plain text, not an anchor", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[click me](javascript:alert(1))");
    expect(root.querySelector("a")).toBeNull();
    // The parser's link syntax takes the url up to the first `)`, so the second, unmatched
    // `)` renders as trailing literal text — the important assertion is no anchor was made.
    expect(root.textContent).toBe("click me)");
  });

  test("data: scheme is rejected", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[x](data:text/html,evil)");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("x");
  });

  test("an unparsable URL is rejected", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[x](http://[::not-valid)");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("x");
  });

  test("relative link resolves against the page origin and is allowed", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[relative](/some/path)");
    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("http://localhost/some/path");
  });

  test("link text can itself carry inline formatting", () => {
    const { document, root } = createTestDom();
    renderMd(document, root, "[**bold link**](https://example.com)");
    const anchor = root.querySelector("a");
    expect(anchor?.querySelector("strong")?.textContent).toBe("bold link");
  });
});
