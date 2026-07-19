import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AgentNode } from "../state.ts";
import { applyEvent, createInitialState, selectedAgent } from "../state.ts";
import { Transcript } from "./Transcript.tsx";

afterEach(cleanup);

function agentWithOutput() {
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
    type: "agent_output",
    agentId: "root-1",
    chunk: "hello world",
  });
  return selectedAgent(state);
}

describe("Transcript", () => {
  test("renders the empty state when there is no agent", () => {
    const { container } = render(<Transcript agent={null} sessionEnded={false} exitCode={null} />);
    expect(container.querySelector(".empty-state")?.textContent).toContain("Waiting for an agent");
  });

  test("renders the empty state with the agent's model when it has no turns yet", () => {
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
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    expect(container.querySelector(".empty-state")?.textContent).toContain("sonnet");
  });

  test("renders assistant output as markdown-parsed turn text", () => {
    const { container } = render(
      <Transcript agent={agentWithOutput()} sessionEnded={false} exitCode={null} />,
    );
    const turn = container.querySelector(".turn-assistant");
    expect(turn?.textContent).toContain("hello world");
  });

  test("shows the session-end echo once the session has ended", () => {
    const { container } = render(
      <Transcript agent={agentWithOutput()} sessionEnded={true} exitCode={0} />,
    );
    expect(container.querySelector(".session-end-echo")?.textContent).toContain("Session ended");
  });

  test("shows the thinking indicator while running with no open assistant turn", () => {
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
      type: "agent_status",
      agentId: "root-1",
      status: "running",
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    expect(container.querySelector(".turn-thinking")).not.toBeNull();
  });

  // Regression coverage for DH-0129's real bug: scrollHeight only takes its post-growth value
  // once new content actually lands (matching what a real browser does -- by the time the
  // content-update effect runs, the DOM has already grown). A scrollHeight that stays constant
  // across rerenders can't exercise the bug where isNearBottom() was computed AFTER the growth
  // and mistook the height delta for "user scrolled away."
  function mutateScrollMetrics(
    region: HTMLElement,
    metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number },
  ) {
    Object.defineProperty(region, "scrollHeight", {
      value: metrics.scrollHeight,
      configurable: true,
    });
    Object.defineProperty(region, "clientHeight", {
      value: metrics.clientHeight,
      configurable: true,
    });
    if (metrics.scrollTop !== undefined) {
      Object.defineProperty(region, "scrollTop", {
        value: metrics.scrollTop,
        configurable: true,
        writable: true,
      });
    }
  }

  test("auto-scrolls to the new bottom when content grows while already near the bottom", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    // User is scrolled to the bottom of the initial, shorter content.
    mutateScrollMetrics(scrollRegion, { scrollHeight: 500, clientHeight: 200, scrollTop: 300 });
    fireEvent.scroll(scrollRegion);

    // A real browser grows scrollHeight as soon as the new, taller content is committed --
    // simulate that growth landing before the content-update effect runs.
    mutateScrollMetrics(scrollRegion, { scrollHeight: 900, clientHeight: 200 });
    const grown: AgentNode = {
      ...agent,
      transcript: [
        ...agent.transcript,
        { role: "user", text: "more", timestamp: "2026-01-01T00:00:02Z" },
      ],
    };
    rerender(<Transcript agent={grown} sessionEnded={false} exitCode={null} />);

    expect(scrollRegion.scrollTop).toBe(900);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(true);
  });

  test("stays put and reveals the jump-to-latest button when content grows while scrolled away", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    // User has scrolled up, away from the bottom of the initial content.
    mutateScrollMetrics(scrollRegion, { scrollHeight: 500, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(scrollRegion);

    // New content grows scrollHeight even though the user never moved scrollTop.
    mutateScrollMetrics(scrollRegion, { scrollHeight: 900, clientHeight: 200 });
    const grown: AgentNode = {
      ...agent,
      transcript: [
        ...agent.transcript,
        { role: "user", text: "more", timestamp: "2026-01-01T00:00:02Z" },
      ],
    };
    rerender(<Transcript agent={grown} sessionEnded={false} exitCode={null} />);

    expect(scrollRegion.scrollTop).toBe(0);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(false);
  });

  test("clicking jump-to-latest scrolls back to the bottom and hides the button", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    mutateScrollMetrics(scrollRegion, { scrollHeight: 500, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(scrollRegion);

    mutateScrollMetrics(scrollRegion, { scrollHeight: 900, clientHeight: 200 });
    const grown: AgentNode = {
      ...agent,
      transcript: [
        ...agent.transcript,
        { role: "user", text: "more", timestamp: "2026-01-01T00:00:02Z" },
      ],
    };
    rerender(<Transcript agent={grown} sessionEnded={false} exitCode={null} />);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(false);

    const jumpButton = container.querySelector(".jump-to-latest") as HTMLElement;
    fireEvent.click(jumpButton);

    expect(scrollRegion.scrollTop).toBe(900);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(true);
  });

  // DH-0200 regression: a manual mouse-wheel scroll away from the bottom, with no new
  // content ever arriving, must reveal the jump-to-latest button on its own. Before the fix,
  // `onScroll` only ever cleared `jumpVisible` (when near the bottom); it never set it, so a
  // pure scroll-driven move away from the bottom left the button stuck hidden.
  test("DH-0200: scrolling away from the bottom with no new content reveals jump-to-latest", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container } = render(<Transcript agent={agent} sessionEnded={false} exitCode={null} />);
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(true);

    mutateScrollMetrics(scrollRegion, { scrollHeight: 900, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(scrollRegion);

    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(false);

    // Scrolling further away must not spuriously re-hide it.
    mutateScrollMetrics(scrollRegion, { scrollHeight: 900, clientHeight: 200, scrollTop: 10 });
    fireEvent.scroll(scrollRegion);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(false);
  });

  test("shows a tool-turn marker for a tool call", () => {
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
      type: "tool_call",
      agentId: "root-1",
      toolUseId: "t1",
      toolName: "Bash",
      inputSummary: "bun test",
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    const toolTurn = container.querySelector(".turn-tool");
    expect(toolTurn?.textContent).toContain("Bash: bun test");
  });

  test("DH-0199: clicking a standalone tool call expands input+result detail together", () => {
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
      type: "tool_call",
      agentId: "root-1",
      toolUseId: "t1",
      toolName: "Bash",
      inputSummary: "bun test",
    });
    state = applyEvent(state, {
      version: 1,
      id: "e3",
      timestamp: "2026-01-01T00:00:02Z",
      type: "tool_result",
      agentId: "root-1",
      toolUseId: "t1",
      toolName: "Bash",
      isError: false,
      durationMs: 42,
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    expect(container.querySelector(".tool-call-detail")).toBeNull();
    const row = container.querySelector(".turn-tool") as HTMLElement;
    fireEvent.click(row);
    const detail = container.querySelector(".tool-call-detail");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("Bash: bun test");
    expect(detail?.textContent).toContain("✓ ok");
    expect(detail?.textContent).toContain("42ms");
    // Clicking again collapses it.
    fireEvent.click(row);
    expect(container.querySelector(".tool-call-detail")).toBeNull();
  });

  test("DH-0199: Enter/Space toggles a standalone tool call's detail via keyboard", () => {
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
      type: "tool_call",
      agentId: "root-1",
      toolUseId: "t1",
      toolName: "Bash",
      inputSummary: "bun test",
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    const row = container.querySelector(".turn-tool") as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(container.querySelector(".tool-call-detail")?.textContent).toContain("pending…");
    fireEvent.keyDown(row, { key: " " });
    expect(container.querySelector(".tool-call-detail")).toBeNull();
    // An unrelated key is a no-op.
    fireEvent.keyDown(row, { key: "Tab" });
    expect(container.querySelector(".tool-call-detail")).toBeNull();
  });

  test("DH-0199: a run of 2+ consecutive tool calls with no turn between them renders as a collapsed group", () => {
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
    for (const [i, name] of ["Bash", "Read", "Edit"].entries()) {
      state = applyEvent(state, {
        version: 1,
        id: `call-${i}`,
        timestamp: "2026-01-01T00:00:01Z",
        type: "tool_call",
        agentId: "root-1",
        toolUseId: `t${i}`,
        toolName: name,
        inputSummary: `input-${i}`,
      });
      state = applyEvent(state, {
        version: 1,
        id: `result-${i}`,
        timestamp: "2026-01-01T00:00:02Z",
        type: "tool_result",
        agentId: "root-1",
        toolUseId: `t${i}`,
        toolName: name,
        isError: i === 2,
        durationMs: 5,
      });
    }
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    // Collapsed by default: no individual tool rows visible, just the group summary.
    expect(container.querySelectorAll(".turn-tool").length).toBe(0);
    const toggle = container.querySelector(".tool-group-toggle") as HTMLElement;
    expect(toggle.textContent).toContain("3 tool calls");
    expect(toggle.textContent).toContain("1 failed");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const rows = container.querySelectorAll(".turn-tool");
    expect(rows.length).toBe(3);
    expect(rows[0]?.textContent).toContain("Bash: input-0");
    expect(rows[2]?.textContent).toContain("Edit: input-2 ✗");

    // Individual rows inside an expanded group are still independently clickable.
    fireEvent.click(rows[0] as HTMLElement);
    expect(container.querySelectorAll(".tool-call-detail").length).toBe(1);

    fireEvent.click(toggle);
    expect(container.querySelectorAll(".turn-tool").length).toBe(0);
  });

  test("DH-0199: a single tool call (no run) does not get wrapped in a group", () => {
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
      type: "tool_call",
      agentId: "root-1",
      toolUseId: "t1",
      toolName: "Bash",
      inputSummary: "bun test",
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    expect(container.querySelector(".tool-group-toggle")).toBeNull();
    expect(container.querySelector(".turn-tool")).not.toBeNull();
  });

  test("DH-0199: a terminal-status marker breaks a run of consecutive tool calls into separate groups", () => {
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
    for (const i of [0, 1]) {
      state = applyEvent(state, {
        version: 1,
        id: `call-${i}`,
        timestamp: "2026-01-01T00:00:01Z",
        type: "tool_call",
        agentId: "root-1",
        toolUseId: `t${i}`,
        toolName: "Bash",
        inputSummary: `input-${i}`,
      });
    }
    // Terminal-status marker turns (DH-0130) are never groupable, breaking the run.
    state = applyEvent(state, {
      version: 1,
      id: "status",
      timestamp: "2026-01-01T00:00:02Z",
      type: "agent_status",
      agentId: "root-1",
      status: "done",
    });
    for (const i of [2, 3]) {
      state = applyEvent(state, {
        version: 1,
        id: `call-${i}`,
        timestamp: "2026-01-01T00:00:03Z",
        type: "tool_call",
        agentId: "root-1",
        toolUseId: `t${i}`,
        toolName: "Bash",
        inputSummary: `input-${i}`,
      });
    }
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    const toggles = container.querySelectorAll(".tool-group-toggle");
    expect(toggles.length).toBe(2);
    expect(container.querySelector(".turn-terminal-status")).not.toBeNull();
  });

  test("DH-0130: a terminal-status marker turn renders with STATUS_TOKENS styling, not the generic tool style", () => {
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
      type: "agent_status",
      agentId: "root-1",
      status: "failed",
    });
    const { container } = render(
      <Transcript agent={selectedAgent(state)} sessionEnded={false} exitCode={null} />,
    );
    const marker = container.querySelector(".turn-terminal-status");
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain("Agent failed");
    expect((marker as HTMLElement).style.color).toBe("#f2545b");
    expect(container.querySelector(".turn-tool")).toBeNull();
  });
});
