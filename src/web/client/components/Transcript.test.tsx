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

  test("reveals the jump-to-latest button when new content arrives while scrolled away from the bottom", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scrollRegion, "scrollTop", { value: 0, configurable: true });

    const grown: AgentNode = {
      ...agent,
      transcript: [
        ...agent.transcript,
        { role: "user", text: "more", timestamp: "2026-01-01T00:00:02Z" },
      ],
    };
    rerender(<Transcript agent={grown} sessionEnded={false} exitCode={null} />);

    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(false);
  });

  test("auto-scrolls to the bottom when new content arrives while already near the bottom", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scrollRegion, "scrollTop", {
      value: 820,
      configurable: true,
      writable: true,
    });

    const grown: AgentNode = {
      ...agent,
      transcript: [
        ...agent.transcript,
        { role: "user", text: "more", timestamp: "2026-01-01T00:00:02Z" },
      ],
    };
    rerender(<Transcript agent={grown} sessionEnded={false} exitCode={null} />);

    expect(scrollRegion.scrollTop).toBe(1000);
    expect(container.querySelector(".jump-to-latest")?.classList.contains("hidden")).toBe(true);
  });

  test("clicking jump-to-latest scrolls back to the bottom and hides the button", () => {
    const agent = agentWithOutput() as AgentNode;
    const { container, rerender } = render(
      <Transcript agent={agent} sessionEnded={false} exitCode={null} />,
    );
    const scrollRegion = container.querySelector(".output-scroll") as HTMLElement;
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scrollRegion, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });

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

    expect(scrollRegion.scrollTop).toBe(1000);
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
