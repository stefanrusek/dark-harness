import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import type { HeaderStatusFacts } from "../../cli/header.ts";
import { renderHeaderA2 } from "../../cli/header.ts";
import { HEADER_A2_WORDMARK_PLAIN } from "../../prompt/banner.constant.ts";
import { initialState } from "../state.ts";
import { buildRootEmptyText, RootView } from "./RootView.tsx";

function rootState(size: { rows: number; cols: number } = { rows: 24, cols: 80 }) {
  return initialState(size, { ownsServer: false });
}

const FACTS: HeaderStatusFacts = {
  version: "0.1.0",
  gitSha: "abc1234",
  configLine: "dh.json — 3 models",
  bindHost: "127.0.0.1:4096",
  hasToken: false,
  logDir: "/tmp/.dh-logs/abcdef01-...",
};

describe("buildRootEmptyText (DH-0124/DH-0245)", () => {
  test("just the friendly first-message prompt — the app-identity banner now lives in RootView's headerLines (renderHeaderA2), not here", () => {
    expect(buildRootEmptyText()).toBe("Type a message below to get started.");
  });

  test("no longer implies the harness/root agent itself hasn't started", () => {
    expect(buildRootEmptyText()).not.toContain("Waiting for root agent to start");
  });
});

describe("RootView (DH-0124)", () => {
  test("before any turns exist, invites the first message, not a 'waiting' message", () => {
    const state = rootState();
    const { lastFrame } = render(
      React.createElement(RootView, { state, contentRows: 10, cols: 80 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Type a message below to get started.");
    expect(frame).not.toContain("Waiting for root agent to start");
  });
});

describe("RootView header (DH-0245)", () => {
  test("User Story 1: with a `header` prop and a large/truecolor terminal, shows Header A2's real gradient wordmark content, in real color — not the old plain-text-only empty state", () => {
    const state = rootState({ rows: 30, cols: 80 });
    const { lastFrame } = render(
      React.createElement(RootView, {
        state,
        contentRows: 20,
        cols: 80,
        header: { facts: FACTS, level: "truecolor" },
      }),
    );
    const frame = lastFrame() ?? "";
    // Real color: at least one truecolor SGR foreground escape sequence is present (the
    // gradient wordmark's char-by-char lerpHex/paint output), not just plain glyphs.
    expect(frame).toContain("\x1b[38;2;");
    // Real content: the status-tree line built from `facts`, not `formatEmptyStateLines`'s
    // generic plain fallback.
    expect(frame).toContain(FACTS.configLine);
    expect(frame).toContain("Type a message below to get started.");
  });

  test("without a `header` prop, no headerLines are prepended — same content as before this ticket (regression guard for standalone RootView test callers)", () => {
    const state = rootState();
    const { lastFrame } = render(
      React.createElement(RootView, { state, contentRows: 10, cols: 80 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain(HEADER_A2_WORDMARK_PLAIN.split("\n")[0]);
  });

  test("User Story 4: on a terminal below the size gate, uses the exact same plain-fallback content `renderHeaderA2` itself falls back to — not a second, independently-maintained fallback string", () => {
    const state = rootState({ rows: 20, cols: 60 });
    const { lastFrame } = render(
      React.createElement(RootView, {
        state,
        contentRows: 12,
        cols: 60,
        header: { facts: FACTS, level: "truecolor" },
      }),
    );
    const frame = lastFrame() ?? "";
    const expectedFallback = renderHeaderA2(FACTS, "truecolor", { columns: 60, rows: 20 });
    // Same plain-fallback line content `renderHeaderA2` produces when its own size gate fails
    // (single source of truth — RootView never re-derives this fallback string itself).
    for (const line of expectedFallback) {
      if (line.length > 0) expect(frame).toContain(line);
    }
    // And it really is the plain fallback (no color escape codes), confirming the size gate
    // — not the color level — is what's driving the fallback here.
    expect(frame).not.toContain("\x1b[38;2;");
  });

  test("`level: 'none'` (NO_COLOR/--plain/non-TTY) uses the plain fallback even on a large terminal", () => {
    const state = rootState({ rows: 30, cols: 80 });
    const { lastFrame } = render(
      React.createElement(RootView, {
        state,
        contentRows: 20,
        cols: 80,
        header: { facts: FACTS, level: "none" },
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain(HEADER_A2_WORDMARK_PLAIN);
    expect(frame).not.toContain("\x1b[38;2;");
  });
});
