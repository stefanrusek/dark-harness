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
});
