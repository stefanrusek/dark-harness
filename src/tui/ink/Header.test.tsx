import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { Header } from "./Header.tsx";

describe("Header", () => {
  test("renders zero rows until DH-0122/DH-0124 populate content", () => {
    const { lastFrame } = render(React.createElement(Header, { variant: "full" }));
    expect(lastFrame()).toBe("");
  });

  test("accepts both the 'full' and 'empty' variants (single-component contract)", () => {
    const full = render(React.createElement(Header, { variant: "full" }));
    const empty = render(React.createElement(Header, { variant: "empty" }));
    expect(full.lastFrame()).toBe(empty.lastFrame());
  });
});
