import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { initialState } from "../state.ts";
import type { TuiState } from "../types.type.ts";
import { TitleBar, titleBarText } from "./TitleBar.tsx";

function state(overrides: Partial<TuiState> = {}): TuiState {
  return { ...initialState({ rows: 24, cols: 80 }, { ownsServer: false }), ...overrides };
}

describe("titleBarText", () => {
  test("includes the app name, view label, and connection state", () => {
    const text = titleBarText(state(), 80);
    expect(text).toContain("Dark Harness");
    expect(text).toContain("Root Agent");
    expect(text).toContain("connecting");
  });

  test("includes a session-ended suffix once the session has ended", () => {
    const text = titleBarText(state({ sessionEnded: { exitCode: 1 } }), 80);
    expect(text).toContain("session ended (exit 1)");
  });

  test("includes a reconnect-notice suffix when set", () => {
    const text = titleBarText(state({ reconnectNotice: "history may be incomplete" }), 80);
    expect(text).toContain("⚠ history may be incomplete");
  });
});

describe("TitleBar", () => {
  test("renders the title line and a full-width separator", () => {
    const { lastFrame } = render(React.createElement(TitleBar, { state: state(), cols: 20 }));
    const rows = (lastFrame() ?? "").split("\n");
    expect(rows.length).toBe(2);
    expect(rows[1]).toContain("─".repeat(20));
  });
});
