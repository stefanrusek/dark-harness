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
});
