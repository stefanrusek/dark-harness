import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent.tsx";

afterEach(cleanup);

describe("MarkdownContent", () => {
  test("renders parsed markdown into a turn-text div", () => {
    const { container } = render(<MarkdownContent text="hello **world**" />);
    const node = container.querySelector(".turn-text");
    expect(node).not.toBeNull();
    expect(node?.querySelector("strong")?.textContent).toBe("world");
  });

  test("re-renders when text changes", () => {
    const { container, rerender } = render(<MarkdownContent text="one" />);
    rerender(<MarkdownContent text="two" />);
    expect(container.querySelector(".turn-text")?.textContent).toBe("two");
  });
});
