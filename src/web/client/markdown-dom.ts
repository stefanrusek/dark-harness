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

const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

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
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      renderInlineNodes(doc, node.children, anchor);
      parent.appendChild(anchor);
      return;
    }
  }
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
      const pre = el(doc, "pre");
      const code = el(doc, "code");
      const languageClass = safeLanguageClass(block.info);
      if (languageClass) code.className = languageClass;
      code.textContent = block.text;
      pre.appendChild(code);
      parent.appendChild(pre);
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
