import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { initialState } from "../state.ts";
import { Composer } from "./Composer.tsx";

function rootState(overrides: Parameters<typeof initialState>[0] = { rows: 24, cols: 80 }) {
  return initialState(overrides, { ownsServer: false });
}

describe("Composer", () => {
  test("shows typed text and the default hint", () => {
    const state = { ...rootState(), input: "hello world", inputCursor: 11 };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    expect(lastFrame()).toContain("hello world");
    expect(lastFrame()).toContain("[Enter] send");
  });

  test("preserves in-progress typed text across a background liveness tick", () => {
    // DH-0136 User Story 1: a background tick only advances `state.now` — it must never
    // clobber `state.input`/`inputCursor`, the regression this test guards against (restated
    // from DH-0133/DH-0135's Web equivalent).
    const base = { ...rootState(), input: "still typing", inputCursor: 12 };
    const { lastFrame, rerender } = render(React.createElement(Composer, { state: base }));
    expect(lastFrame()).toContain("still typing");

    const afterTick = { ...base, now: base.now + 5000 };
    rerender(React.createElement(Composer, { state: afterTick }));
    expect(lastFrame()).toContain("still typing");
  });

  // DH-0142: dropdown rendering.
  test("shows the autocomplete dropdown while typing a slash command", () => {
    const state = { ...rootState(), input: "/mo", inputCursor: 3 };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).toContain("switch the active model");
  });

  test("highlights the entry at dropdownIndex", () => {
    const state = { ...rootState(), input: "/", inputCursor: 1, dropdownIndex: 1 };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    // ink-testing-library renders `inverse` text with ANSI codes we don't assert on
    // directly; asserting the frame still contains every command name is a reasonable
    // proxy that rendering didn't throw/skip entries when a non-zero index is highlighted.
    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).toContain("/help");
    expect(lastFrame()).toContain("/clear");
  });

  test("does not render a dropdown for plain chat text", () => {
    const state = { ...rootState(), input: "hello", inputCursor: 5 };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    expect(lastFrame()).not.toContain("switch the active model");
  });

  test("does not render a dropdown once dismissed", () => {
    const state = { ...rootState(), input: "/mo", inputCursor: 3, dropdownDismissed: true };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    expect(lastFrame()).not.toContain("switch the active model");
  });

  // DH-0231: a line longer than the input box's width must wrap to additional lines and
  // stay fully visible, rather than scrolling off-screen or truncating.
  test("wraps a long input line instead of scrolling it off-screen", () => {
    const longText = "a".repeat(120);
    const state = { ...rootState(), input: longText, inputCursor: longText.length };
    const { lastFrame } = render(React.createElement(Composer, { state, cols: 40 }));
    const frame = lastFrame() ?? "";
    // The full run of "a"s must appear somewhere in the rendered frame (across wrapped
    // rows) — not just a 40-char prefix, and no row should be wider than the given width.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ANSI SGR codes
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripAnsi(frame).replace(/\n/g, "")).toContain(longText);
    // Skip the first (hint) row — it isn't width-constrained by this fix, only the input
    // row below it is, per the ticket's scope.
    for (const line of frame.split("\n").slice(1)) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(40);
    }
  });

  test("grows the box height to fit wrapped content across multiple rows", () => {
    const longText = "b".repeat(120);
    const state = { ...rootState(), input: longText, inputCursor: longText.length };
    const { lastFrame } = render(React.createElement(Composer, { state, cols: 40 }));
    const frame = lastFrame() ?? "";
    // 120 chars at width 40 needs at least 3 wrapped rows for the input line alone, plus
    // the hint row above it — assert the frame grew well past the old fixed 2-row layout.
    expect(frame.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  test("defaults cols when the caller doesn't specify a width", () => {
    const state = { ...rootState(), input: "hi", inputCursor: 2 };
    const { lastFrame } = render(React.createElement(Composer, { state }));
    expect(lastFrame()).toContain("hi");
  });
});
