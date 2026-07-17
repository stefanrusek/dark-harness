import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { StatusRow } from "./StatusRow.tsx";

describe("StatusRow", () => {
  test("renders zero rows until DH-0125 populates content", () => {
    const { lastFrame } = render(React.createElement(StatusRow, {}));
    expect(lastFrame()).toBe("");
  });
});
