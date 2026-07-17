import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { BUILD_INFO } from "../../config/build-info.ts";
import { formatVersionString } from "../../header-info.ts";
import { Header } from "./Header.tsx";

describe("Header", () => {
  test("'full' variant (DH-0122) renders the version/build-identity line", () => {
    const { lastFrame } = render(React.createElement(Header, { variant: "full" }));
    expect(lastFrame()).toContain(formatVersionString(BUILD_INFO));
  });

  test("'empty' variant (DH-0124, still TODO) renders zero rows", () => {
    const { lastFrame } = render(React.createElement(Header, { variant: "empty" }));
    expect(lastFrame()).toBe("");
  });
});
