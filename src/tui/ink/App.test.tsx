import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "ink-testing-library";
import React from "react";
import { initialState, reducer } from "../state.ts";
import { flattenTree } from "../tree.ts";
import type { TuiState } from "../types.ts";
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

  test("root view: reserved <Header>/<StatusRow> slots render zero rows — frame height matches terminal rows exactly", () => {
    const state = rootState();
    const { lastFrame } = render(React.createElement(App, { state }));
    const rows = (lastFrame() ?? "").split("\n");
    expect(rows.length).toBe(state.size.rows);
  });

  test("tree view: reserved slots still contribute zero rows", () => {
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

  test("<StatusRow> is positioned directly after the composer in the root view", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const composerIndex = source.indexOf("<Composer");
    const statusRowIndex = source.indexOf("<StatusRow");
    expect(composerIndex).toBeGreaterThan(-1);
    expect(statusRowIndex).toBeGreaterThan(composerIndex);
  });
});
