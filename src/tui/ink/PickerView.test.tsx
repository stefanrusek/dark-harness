import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { initialState } from "../state.ts";
import type { TuiState } from "../types.ts";
import { PickerView } from "./PickerView.tsx";

function pickerState(overrides: Partial<TuiState> = {}): TuiState {
  return { ...initialState({ rows: 24, cols: 80 }, { ownsServer: false }), ...overrides };
}

describe("PickerView", () => {
  test("renders null outside the picker view (nothing to show)", () => {
    const state = pickerState({ view: { kind: "root" } });
    const { lastFrame } = render(
      React.createElement(PickerView, { state, contentRows: 5, cols: 40 }),
    );
    expect(lastFrame()).toBe("");
  });

  test("no models configured shows the fallback message", () => {
    const state = pickerState({ view: { kind: "picker", options: [], selectedIndex: 0 } });
    const { lastFrame } = render(
      React.createElement(PickerView, { state, contentRows: 5, cols: 40 }),
    );
    expect(lastFrame()).toContain("No models configured.");
  });

  test("lists model options with active/default tags and marks the selected row", () => {
    const state = pickerState({
      view: {
        kind: "picker",
        selectedIndex: 1,
        options: [
          {
            name: "haiku",
            provider: "anthropic",
            model: "claude-haiku",
            isDefault: false,
            isActive: false,
          },
          {
            name: "sonnet",
            provider: "anthropic",
            model: "claude-sonnet",
            isDefault: true,
            isActive: true,
          },
        ],
      },
    });
    const { lastFrame } = render(
      React.createElement(PickerView, { state, contentRows: 5, cols: 60 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("haiku");
    expect(frame).toContain("sonnet");
    expect(frame).toContain("active, default");
    expect(frame).toContain("> sonnet");
  });
});
