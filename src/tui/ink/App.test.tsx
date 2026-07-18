import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "ink-testing-library";
import React from "react";
import { initialState, reducer } from "../state.ts";
import { flattenTree } from "../tree.ts";
import type { TuiState } from "../types.type.ts";
import { App } from "./App.tsx";

function rootState(): TuiState {
  return initialState({ rows: 24, cols: 80 }, { ownsServer: false });
}

describe("App", () => {
  test("composes <Header> above the content and <StatusRow> in the tree (source contract)", () => {
    // DH-0136 User Story 2/3: `<Header>`/`<StatusRow>` are reserved slots in the composition
    // — a grep-style regression test (same pattern as design-tokens.test.ts's drift guard)
    // rather than a fiber-tree inspection, since both components render `null` and so leave
    // no trace in `lastFrame()` to assert on directly.
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/<Header\b/);
    expect(source).toMatch(/<StatusRow\b/);
    expect(source.indexOf("<Header")).toBeLessThan(source.indexOf("<StatusRow"));
  });

  test("root view: <Header> renders zero rows, <StatusRow> renders its one line — frame height matches terminal rows exactly", () => {
    const state = rootState();
    const { lastFrame } = render(React.createElement(App, { state }));
    const rows = (lastFrame() ?? "").split("\n");
    expect(rows.length).toBe(state.size.rows);
  });

  test("tree view: <Header> still contributes zero rows, layout still fits the frame exactly", () => {
    let state = rootState();
    state = reducer(state, {
      type: "tree_response",
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ],
    }).state;
    state = { ...state, view: { kind: "tree", selectedIndex: 0 } };
    expect(flattenTree(state.tree ?? []).length).toBe(1);
    const { lastFrame } = render(React.createElement(App, { state }));
    const rows = (lastFrame() ?? "").split("\n");
    expect(rows.length).toBe(state.size.rows);
  });

  test("<StatusRow> is positioned directly after the root view (which owns the composer)", () => {
    // Composer now lives inside RootView.tsx, not inlined in App.tsx directly — confirm both
    // halves of the contract: RootView renders <Composer>, and App renders <StatusRow> after
    // <RootView>.
    const rootViewSource = readFileSync(new URL("./RootView.tsx", import.meta.url), "utf8");
    expect(rootViewSource).toMatch(/<Composer\b/);
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const rootViewIndex = appSource.indexOf("<RootView");
    const statusRowIndex = appSource.indexOf("<StatusRow");
    expect(rootViewIndex).toBeGreaterThan(-1);
    expect(statusRowIndex).toBeGreaterThan(rootViewIndex);
  });
});
