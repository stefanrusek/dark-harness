import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { applyEvent, createInitialState } from "../state.ts";
import { Sidebar } from "./Sidebar.tsx";

afterEach(cleanup);

function stateWithTwoAgents() {
  let state = createInitialState();
  state = applyEvent(state, {
    version: 1,
    id: "e1",
    timestamp: "2026-01-01T00:00:00Z",
    type: "agent_spawned",
    agentId: "root-1",
    parentAgentId: null,
    model: "sonnet",
  });
  state = applyEvent(state, {
    version: 1,
    id: "e2",
    timestamp: "2026-01-01T00:00:01Z",
    type: "agent_spawned",
    agentId: "child-1",
    parentAgentId: "root-1",
    model: "haiku",
    description: "Fix the bug",
  });
  return state;
}

describe("Sidebar", () => {
  test("renders one row per agent, indenting children", () => {
    const state = stateWithTwoAgents();
    const { container } = render(
      <Sidebar
        state={state}
        onSelect={() => {}}
        now={Date.parse(state.agents.get("root-1")?.statusSince ?? "")}
      />,
    );
    const rows = container.querySelectorAll(".agent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains("root")).toBe(true);
    expect(rows[1]?.querySelector(".agent-label")?.textContent).toBe("Fix the bug");
  });

  test("clicking or Enter/Space on a row selects it", () => {
    const state = stateWithTwoAgents();
    const selected: string[] = [];
    const { container } = render(<Sidebar state={state} onSelect={(id) => selected.push(id)} />);
    const rows = container.querySelectorAll(".agent-row");
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "Enter" });
    expect(selected).toEqual(["root-1", "child-1"]);
  });

  test("marks the selected agent's row", () => {
    const state = { ...stateWithTwoAgents(), selectedAgentId: "child-1" };
    const { container } = render(<Sidebar state={state} onSelect={() => {}} />);
    const rows = container.querySelectorAll(".agent-row");
    expect(rows[1]?.classList.contains("selected")).toBe(true);
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
  });
});
