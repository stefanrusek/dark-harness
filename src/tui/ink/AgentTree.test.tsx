import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import type { AgentTreeNode } from "../../contracts/index.ts";
import { initialState } from "../state.ts";
import type { TuiState } from "../types.type.ts";
import { AgentTree } from "./AgentTree.tsx";

function treeState(tree: AgentTreeNode[], selectedIndex = 0): TuiState {
  return {
    ...initialState({ rows: 24, cols: 80 }, { ownsServer: false }),
    tree,
    view: { kind: "tree", selectedIndex },
  };
}

describe("AgentTree", () => {
  test("no agents yet shows the empty message", () => {
    const state = treeState([]);
    const { lastFrame } = render(
      React.createElement(AgentTree, { state, contentRows: 5, cols: 60 }),
    );
    expect(lastFrame()).toContain("No agents yet.");
  });

  test("lists agents with a status glyph, status word, and selection marker on the selected row", () => {
    const tree: AgentTreeNode[] = [
      { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
    ];
    const state = treeState(tree, 0);
    const { lastFrame } = render(
      React.createElement(AgentTree, { state, contentRows: 5, cols: 60 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("running");
    expect(frame).toContain("root (sonnet)");
    expect(frame).toContain(">");
  });

  test("uses the agent's description as its label when present", () => {
    const tree: AgentTreeNode[] = [
      {
        agentId: "root",
        parentAgentId: null,
        model: "sonnet",
        status: "done",
        description: "Fix flaky test",
        children: [],
      },
    ];
    const state = treeState(tree, 0);
    const { lastFrame } = render(
      React.createElement(AgentTree, { state, contentRows: 5, cols: 60 }),
    );
    expect(lastFrame() ?? "").toContain("Fix flaky test");
  });
});
