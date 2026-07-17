import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { initialState, reducer } from "../state.ts";
import type { TuiState } from "../types.ts";
import { AgentView } from "./AgentView.tsx";

function spawned(agentId: string) {
  return {
    version: 1 as const,
    id: `e-${agentId}`,
    timestamp: "2026-07-17T00:00:00.000Z",
    type: "agent_spawned" as const,
    agentId,
    parentAgentId: null,
    model: "sonnet",
  };
}

describe("AgentView", () => {
  test("renders null outside the agent view", () => {
    const state = initialState({ rows: 24, cols: 80 }, { ownsServer: false });
    const { lastFrame } = render(
      React.createElement(AgentView, { state, contentRows: 5, cols: 40 }),
    );
    expect(lastFrame()).toBe("");
  });

  test("unknown agentId shows '(no output yet)' and 'Model: (unknown)'", () => {
    const state: TuiState = {
      ...initialState({ rows: 24, cols: 80 }, { ownsServer: false }),
      view: { kind: "agent", agentId: "missing" },
    };
    const { lastFrame } = render(
      React.createElement(AgentView, { state, contentRows: 5, cols: 40 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("(no output yet)");
    expect(frame).toContain("Model: (unknown)");
  });

  test("known agent shows model/status/token meta in the footer hint", () => {
    let state = initialState({ rows: 24, cols: 80 }, { ownsServer: false });
    ({ state } = reducer(state, { type: "sse_event", event: spawned("sub") }));
    state = { ...state, view: { kind: "agent", agentId: "sub" } };
    const { lastFrame } = render(
      React.createElement(AgentView, { state, contentRows: 5, cols: 40 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Model: sonnet");
    expect(frame).toContain("waiting");
  });
});
