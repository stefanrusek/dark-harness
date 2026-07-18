import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { applyEvent, createInitialState } from "../state.ts";
import { AgentHeaderPanel } from "./AgentHeaderPanel.tsx";

afterEach(cleanup);

function noop() {}

describe("AgentHeaderPanel", () => {
  test("renders the empty state when no agent is selected", () => {
    const { container } = render(
      <AgentHeaderPanel
        state={createInitialState()}
        onDownloadAgentLog={noop}
        onDownloadSessionBundle={noop}
        onStopAgent={noop}
      />,
    );
    expect(container.querySelector(".empty-state")?.textContent).toContain("Waiting for an agent");
  });

  test("renders the root agent's title/stats/actions, including Stop while running", () => {
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

    const stopped: string[] = [];
    const { container } = render(
      <AgentHeaderPanel
        state={state}
        onDownloadAgentLog={noop}
        onDownloadSessionBundle={noop}
        onStopAgent={(id) => stopped.push(id)}
      />,
    );
    expect(container.querySelector(".agent-header-name")?.textContent).toBe("Root agent");
    expect(container.querySelector(".agent-header-model")?.textContent).toBe("sonnet");
    const buttons = [...container.querySelectorAll("button")];
    const stopBtn = buttons.find((b) => b.textContent === "Stop");
    expect(stopBtn).toBeDefined();
    if (stopBtn) fireEvent.click(stopBtn);
    expect(stopped).toEqual(["root-1"]);
  });

  test("omits the Stop button once the agent reaches a terminal status", () => {
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
      status: "done",
    });
    const { container } = render(
      <AgentHeaderPanel
        state={state}
        onDownloadAgentLog={noop}
        onDownloadSessionBundle={noop}
        onStopAgent={noop}
      />,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((b) => b.textContent === "Stop")).toBe(false);
  });

  test("download buttons invoke their callbacks", () => {
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
    const logCalls: string[] = [];
    let bundleCalls = 0;
    const { container } = render(
      <AgentHeaderPanel
        state={state}
        onDownloadAgentLog={(id) => logCalls.push(id)}
        onDownloadSessionBundle={() => {
          bundleCalls++;
        }}
        onStopAgent={noop}
      />,
    );
    const buttons = [...container.querySelectorAll("button")];
    fireEvent.click(buttons.find((b) => b.textContent === "Download log") as HTMLElement);
    fireEvent.click(
      buttons.find((b) => b.textContent === "Download session bundle") as HTMLElement,
    );
    expect(logCalls).toEqual(["root-1"]);
    expect(bundleCalls).toBe(1);
  });
});
