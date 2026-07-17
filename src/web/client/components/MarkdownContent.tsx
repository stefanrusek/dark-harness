// Thin React wrapper around the existing DOM-only Markdown renderer (markdown-dom.ts) — kept
// as content logic, not reimplemented in JSX, per DH-0135's instruction to reuse
// markdown-dom.ts unmodified. A ref'd empty <div> is imperatively filled by
// `renderMarkdownInto` whenever `text` changes.
import { type ReactElement, useEffect, useRef } from "react";
import { parseMarkdown } from "../../../markdown/index.ts";
import { renderMarkdownInto } from "../markdown-dom.ts";

export interface MarkdownContentProps {
  text: string;
}

export function MarkdownContent({ text }: MarkdownContentProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    renderMarkdownInto(node.ownerDocument, node, parseMarkdown(text));
  }, [text]);

  return <div className="turn-text" ref={ref} />;
}
