import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JumpToLatestButton } from "./JumpToLatestButton.tsx";

afterEach(cleanup);

describe("JumpToLatestButton", () => {
  test("hidden class toggles with visible prop", () => {
    const { container, rerender } = render(
      <JumpToLatestButton visible={false} onClick={() => {}} />,
    );
    expect(container.querySelector("button")?.classList.contains("hidden")).toBe(true);
    rerender(<JumpToLatestButton visible={true} onClick={() => {}} />);
    expect(container.querySelector("button")?.classList.contains("hidden")).toBe(false);
  });

  test("clicking invokes onClick", () => {
    let clicks = 0;
    const { container } = render(<JumpToLatestButton visible={true} onClick={() => clicks++} />);
    fireEvent.click(container.querySelector("button") as HTMLElement);
    expect(clicks).toBe(1);
  });
});
