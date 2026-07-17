import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { BUILD_INFO } from "../../config/build-info.ts";
import { formatVersionString } from "../../header-info.ts";
import { DH_ASCII_LOGO_COMPACT } from "../../prompt/banner.ts";
import { initialState } from "../state.ts";
import { RootView, buildRootEmptyText } from "./RootView.tsx";

function rootState() {
  return initialState({ rows: 24, cols: 80 }, { ownsServer: false });
}

describe("buildRootEmptyText (DH-0124)", () => {
  test("compact logo + version line, then a blank line, then a friendly first-message prompt", () => {
    expect(buildRootEmptyText()).toBe(
      [
        DH_ASCII_LOGO_COMPACT,
        formatVersionString(BUILD_INFO),
        "",
        "Type a message below to get started.",
      ].join("\n"),
    );
  });

  test("no longer implies the harness/root agent itself hasn't started", () => {
    expect(buildRootEmptyText()).not.toContain("Waiting for root agent to start");
  });
});

describe("RootView (DH-0124)", () => {
  test("before any turns exist, shows the app identity + an invite to send the first message, not a 'waiting' message", () => {
    const state = rootState();
    const { lastFrame } = render(
      React.createElement(RootView, { state, contentRows: 10, cols: 80 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain(DH_ASCII_LOGO_COMPACT);
    expect(frame).toContain(formatVersionString(BUILD_INFO));
    expect(frame).toContain("Type a message below to get started.");
    expect(frame).not.toContain("Waiting for root agent to start");
  });
});
