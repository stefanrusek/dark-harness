import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { applyEvent, createInitialState, selectedAgent } from "../state.ts";
import type { AgentNode } from "../state.ts";
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
