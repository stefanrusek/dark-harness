// Renders a `dh` Markdown AST (src/markdown/index.ts) to sanitized DOM nodes (DH-0056 D4).
// Built entirely with `document.createElement`/`textContent`/`createTextNode` — never
// `innerHTML`/`outerHTML`/`insertAdjacentHTML` — matching the style `render.ts` already uses
// everywhere else, so the "no XSS sink" property the TUI/Web security sweep confirmed is
// preserved. Raw HTML in model output is inert by construction: the AST has no HTML node type
// at all, so there is nothing here that could turn a `<script>` tag into markup.
//
// Links are scheme-filtered to `http:`/`https:`/`mailto:` only (anything else, including
// `javascript:`/`data:`, renders as plain text instead of an anchor) and allowed links get
// `rel="noopener noreferrer"` plus `target="_blank"`, with `href` set via the element property
// — never string-built markup.

import type { BlockNode, InlineNode } from "../../markdown/index.ts";

const ALLOWED_LINK_SCHEMES = Object.freeze(new Set(["http:", "https:", "mailto:"]));

/** Filters a fenced code block's info string to a safe `language-<info>` class token —
 * `[a-z0-9-]` only, matching the "class-attribute hygiene" rule in the ticket. Returns null
 * when nothing safe remains (no class applied). */
function safeLanguageClass(info: string): string | null {
  const filtered = info
    .toLowerCase()
    .split("")
    .filter((c) => /[a-z0-9-]/.test(c))
    .join("");
  return filtered.length > 0 ? `language-${filtered}` : null;
}

/** Resolves a Markdown link URL against the page origin and checks its scheme is one of the
 * allowlisted `ALLOWED_LINK_SCHEMES`. Returns null when the URL is unparsable or the scheme is
 * disallowed — the caller then renders the link as plain text instead of an anchor. */
function safeLinkUrl(doc: Document, url: string): string | null {
  try {
    const base = doc.defaultView?.location.href ?? "http://localhost/";
    const resolved = new URL(url, base);
    return ALLOWED_LINK_SCHEMES.has(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc.createElement(tag);
}

function renderInlineNodes(doc: Document, nodes: InlineNode[], parent: Node): void {
  for (const node of nodes) renderInlineNode(doc, node, parent);
}

function renderInlineNode(doc: Document, node: InlineNode, parent: Node): void {
  switch (node.kind) {
    case "text": {
      // Preserved line breaks (D1) render as literal `<br>` — the parser keeps them as `"\n"`
      // text rather than soft-wrap-joining, so each embedded newline becomes a real break.
      const parts = node.text.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) parent.appendChild(el(doc, "br"));
        if (part !== "") parent.appendChild(doc.createTextNode(part));
      });
      return;
    }
    case "strong": {
      const strong = el(doc, "strong");
      renderInlineNodes(doc, node.children, strong);
      parent.appendChild(strong);
      return;
    }
    case "emphasis": {
      const em = el(doc, "em");
      renderInlineNodes(doc, node.children, em);
      parent.appendChild(em);
      return;
    }
    case "strike": {
      const del = el(doc, "del");
      renderInlineNodes(doc, node.children, del);
      parent.appendChild(del);
      return;
    }
    case "code": {
      const code = el(doc, "code");
      code.textContent = node.text;
      parent.appendChild(code);
      return;
    }
    case "link": {
      const href = safeLinkUrl(doc, node.url);
      if (href === null) {
        // Disallowed/unparsable scheme: render as plain inline text, never as an anchor.
        renderInlineNodes(doc, node.children, parent);
        return;
      }
      const anchor = el(doc, "a");
      anchor.href = href;
      if (node.title) anchor.title = node.title;
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      renderInlineNodes(doc, node.children, anchor);
      parent.appendChild(anchor);
      return;
    }
  }
}

const COPY_LABEL = "Copy";
const COPY_DONE_LABEL = "Copied";
const COPY_FAILED_LABEL = "Copy failed";
const COPY_RESET_DELAY_MS = 1500;

/** Builds the hover-revealed "Copy" button for a code block (DH-0066). Uses the standard
 * async Clipboard API (`navigator.clipboard.writeText`); happy-dom (this file's test DOM,
 * `test-dom.ts`) doesn't implement it, and neither does every embedding context, so the
 * button degrades to a no-op click rather than throwing when it's unavailable — feature-
 * detected via optional chaining, not a hard dependency. */
function makeCopyButton(doc: Document, text: string): HTMLButtonElement {
  const button = el(doc, "button");
  button.type = "button";
  button.className = "code-copy-btn";
  button.textContent = COPY_LABEL;
  button.setAttribute("aria-label", "Copy code block to clipboard");
  button.addEventListener("click", () => {
    const win = doc.defaultView;
    const clipboard = win?.navigator?.clipboard;
    if (!clipboard?.writeText) return;
    const resetAfter = (label: string) => {
      button.textContent = label;
      const setTimeoutFn = win?.setTimeout ?? setTimeout;
      setTimeoutFn(() => {
        button.textContent = COPY_LABEL;
      }, COPY_RESET_DELAY_MS);
    };
    clipboard
      .writeText(text)
      .then(() => resetAfter(COPY_DONE_LABEL))
      .catch(() => resetAfter(COPY_FAILED_LABEL));
  });
  return button;
}

function renderBlockNode(doc: Document, block: BlockNode, parent: Node): void {
  switch (block.kind) {
    case "paragraph": {
      const p = el(doc, "p");
      renderInlineNodes(doc, block.children, p);
      parent.appendChild(p);
      return;
    }
    case "heading": {
      const tag = `h${block.level}` as const as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const heading = el(doc, tag);
      renderInlineNodes(doc, block.children, heading);
      parent.appendChild(heading);
      return;
    }
    case "codeBlock": {
      // DH-0066 "cheap delight" nit: a hover-revealed copy button. Wrapped in its own
      // positioning container (`.code-block`, styles.css) so the button can be absolutely
      // positioned in its corner without disturbing `pre`'s own box — `pre > code` (the
      // fixture/test selector every other spot in this file already relies on) still
      // resolves the same block.
      const wrapper = el(doc, "div");
      wrapper.className = "code-block";
      const pre = el(doc, "pre");
      const code = el(doc, "code");
      const languageClass = safeLanguageClass(block.info);
      if (languageClass) code.className = languageClass;
      code.textContent = block.text;
      pre.appendChild(code);
      wrapper.appendChild(pre);
      wrapper.appendChild(makeCopyButton(doc, block.text));
      parent.appendChild(wrapper);
      return;
    }
    case "list": {
      const list = block.ordered ? el(doc, "ol") : el(doc, "ul");
      if (block.ordered && block.start !== 1) {
        (list as HTMLOListElement).start = block.start;
      }
      for (const item of block.items) {
        const li = el(doc, "li");
        renderBlockNodes(doc, item, li);
        list.appendChild(li);
      }
      parent.appendChild(list);
      return;
    }
    case "blockquote": {
      const quote = el(doc, "blockquote");
      renderBlockNodes(doc, block.children, quote);
      parent.appendChild(quote);
      return;
    }
    case "table": {
      const table = el(doc, "table");
      const thead = el(doc, "thead");
      const headerRow = el(doc, "tr");
      block.header.forEach((cellNodes, idx) => {
        const th = el(doc, "th");
        const align = block.align[idx];
        if (align) th.style.textAlign = align;
        renderInlineNodes(doc, cellNodes, th);
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el(doc, "tbody");
      for (const row of block.rows) {
        const tr = el(doc, "tr");
        row.forEach((cellNodes, idx) => {
          const td = el(doc, "td");
          const align = block.align[idx];
          if (align) td.style.textAlign = align;
          renderInlineNodes(doc, cellNodes, td);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      parent.appendChild(table);
      return;
    }
    case "thematicBreak":
      parent.appendChild(el(doc, "hr"));
      return;
  }
}

function renderBlockNodes(doc: Document, blocks: BlockNode[], parent: Node): void {
  for (const block of blocks) renderBlockNode(doc, block, parent);
}

/** Renders a parsed dh Markdown AST into `container` (its existing content is fully
 * replaced). Public entry point used by `render.ts`'s turn-building code. */
export function renderMarkdownInto(
  doc: Document,
  container: HTMLElement,
  blocks: BlockNode[],
): void {
  container.textContent = "";
  renderBlockNodes(doc, blocks, container);
}
