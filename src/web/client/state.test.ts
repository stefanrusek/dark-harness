import { describe, expect, test } from "bun:test";
import type {
  AgentOutputEvent,
  AgentSpawnedEvent,
  AgentStatusEvent,
  AgentTreeNode,
  SessionEndedEvent,
  TokenUsageEvent,
} from "../../contracts/index.ts";
import {
  applyEvent,
  createInitialState,
  isRoot,
  orderedAgents,
  seedFromTree,
  selectAgent,
  selectedAgent,
  sessionTotals,
  setConnectionStatus,
} from "./state.ts";

function spawned(
  agentId: string,
  parentAgentId: string | null,
  model = "sonnet",
): AgentSpawnedEvent {
  return {
    version: 1,
    id: `evt-${agentId}`,
    timestamp: new Date().toISOString(),
    type: "agent_spawned",
    agentId,
    parentAgentId,
    model,
  };
}

function output(agentId: string, chunk: string): AgentOutputEvent {
  return {
    version: 1,
    id: `evt-out-${agentId}-${chunk}`,
    timestamp: new Date().toISOString(),
    type: "agent_output",
    agentId,
    chunk,
  };
}

function statusEvent(agentId: string, status: AgentStatusEvent["status"]): AgentStatusEvent {
  return {
    version: 1,
    id: `evt-status-${agentId}-${status}`,
    timestamp: new Date().toISOString(),
    type: "agent_status",
    agentId,
    status,
  };
}

function tokenUsage(
  agentId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd?: number,
): TokenUsageEvent {
  return {
    version: 1,
    id: `evt-tok-${agentId}-${inputTokens}-${outputTokens}`,
    timestamp: new Date().toISOString(),
    type: "token_usage",
    agentId,
    inputTokens,
    outputTokens,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function sessionEnded(exitCode: number): SessionEndedEvent {
  return {
    version: 1,
    id: "evt-end",
    timestamp: new Date().toISOString(),
    type: "session_ended",
    exitCode,
  };
}

describe("state reducer", () => {
  test("createInitialState starts empty and connecting", () => {
    const state = createInitialState();
    expect(state.agents.size).toBe(0);
    expect(state.rootAgentId).toBeNull();
    expect(state.selectedAgentId).toBeNull();
    expect(state.connectionStatus).toBe("connecting");
    expect(state.sessionEnded).toBe(false);
    expect(state.exitCode).toBeNull();
  });

  test("agent_spawned with null parent becomes root and gets auto-selected", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null, "sonnet"));
    expect(state.rootAgentId).toBe("root-1");
    expect(state.selectedAgentId).toBe("root-1");
    const node = state.agents.get("root-1");
    expect(node?.model).toBe("sonnet");
    expect(node?.parentAgentId).toBeNull();
  });

  test("a second root-level spawn does not override the first root", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("root-2", null));
    expect(state.rootAgentId).toBe("root-1");
  });

  test("child agent_spawned does not change selection once something is selected", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("child-1", "root-1"));
    expect(state.selectedAgentId).toBe("root-1");
    expect(state.agents.get("child-1")?.parentAgentId).toBe("root-1");
  });

  test("agent_output accumulates chunks in order, creating the agent if unseen", () => {
    let state = createInitialState();
    state = applyEvent(state, output("a1", "hello "));
    state = applyEvent(state, output("a1", "world"));
    expect(state.agents.get("a1")?.output).toBe("hello world");
  });

  test("agent_status updates status, defaulting unseen agents to waiting first", () => {
    let state = createInitialState();
    expect(state.agents.has("a1")).toBe(false);
    state = applyEvent(state, statusEvent("a1", "running"));
    expect(state.agents.get("a1")?.status).toBe("running");
    state = applyEvent(state, statusEvent("a1", "done"));
    expect(state.agents.get("a1")?.status).toBe("done");
  });

  test("token_usage sums deltas across multiple events for the same agent", () => {
    let state = createInitialState();
    state = applyEvent(state, tokenUsage("a1", 100, 50, 0.01));
    state = applyEvent(state, tokenUsage("a1", 20, 5, 0.002));
    const node = state.agents.get("a1");
    expect(node?.inputTokens).toBe(120);
    expect(node?.outputTokens).toBe(55);
    expect(node?.costUsd).toBeCloseTo(0.012, 5);
  });

  test("token_usage without costUsd treats cost as zero delta", () => {
    let state = createInitialState();
    state = applyEvent(state, tokenUsage("a1", 10, 10));
    expect(state.agents.get("a1")?.costUsd).toBe(0);
  });

  test("session_ended sets sessionEnded and exitCode", () => {
    let state = createInitialState();
    state = applyEvent(state, sessionEnded(0));
    expect(state.sessionEnded).toBe(true);
    expect(state.exitCode).toBe(0);
  });

  test("applyEvent does not mutate the previous state object", () => {
    const state = createInitialState();
    const next = applyEvent(state, spawned("root-1", null));
    expect(state.agents.size).toBe(0);
    expect(next.agents.size).toBe(1);
  });

  test("lastEventId tracks the most recently applied event's id", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    expect(state.lastEventId).toBe("evt-root-1");
  });

  test("tolerates an event type this client build doesn't recognize (forward-compat)", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    const unknownEvent = {
      version: 1,
      id: "evt-future",
      timestamp: new Date().toISOString(),
      type: "future_event_type",
    } as unknown as AgentSpawnedEvent;
    const next = applyEvent(state, unknownEvent);
    // Bumps lastEventId (so a resume/diagnostics view still advances) but otherwise leaves
    // state untouched — critically, it does NOT replace state with the raw unrecognized
    // event object.
    expect(next.lastEventId).toBe("evt-future");
    expect(next.rootAgentId).toBe("root-1");
    expect(next.agents.size).toBe(1);
  });
});

describe("setConnectionStatus", () => {
  test("updates connectionStatus without touching other fields", () => {
    const state = createInitialState();
    const next = setConnectionStatus(state, "open");
    expect(next.connectionStatus).toBe("open");
    expect(next.agents).toBe(state.agents);
  });
});

describe("selectAgent / selectedAgent", () => {
  test("selectAgent is a no-op for unknown agent ids", () => {
    const state = createInitialState();
    const next = selectAgent(state, "does-not-exist");
    expect(next).toBe(state);
  });

  test("selectAgent switches selection to a known agent", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("child-1", "root-1"));
    state = selectAgent(state, "child-1");
    expect(state.selectedAgentId).toBe("child-1");
    expect(selectedAgent(state)?.agentId).toBe("child-1");
  });

  test("selectedAgent returns null when nothing is selected", () => {
    const state = createInitialState();
    expect(selectedAgent(state)).toBeNull();
  });
});

describe("isRoot", () => {
  test("true only for the root agent id", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("child-1", "root-1"));
    expect(isRoot(state, "root-1")).toBe(true);
    expect(isRoot(state, "child-1")).toBe(false);
  });
});

describe("orderedAgents", () => {
  test("returns agents sorted by spawn order", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("child-1", "root-1"));
    state = applyEvent(state, spawned("child-2", "root-1"));
    expect(orderedAgents(state).map((a) => a.agentId)).toEqual(["root-1", "child-1", "child-2"]);
  });

  test("an agent implied by an out-of-order event (e.g. output before spawn) still sorts stably", () => {
    let state = createInitialState();
    state = applyEvent(state, output("early", "x"));
    state = applyEvent(state, spawned("root-1", null));
    expect(orderedAgents(state).map((a) => a.agentId)).toEqual(["early", "root-1"]);
  });
});

describe("sessionTotals", () => {
  test("sums tokens/cost across all agents", () => {
    let state = createInitialState();
    state = applyEvent(state, tokenUsage("a1", 10, 5, 0.01));
    state = applyEvent(state, tokenUsage("a2", 20, 8, 0.02));
    const totals = sessionTotals(state);
    expect(totals.inputTokens).toBe(30);
    expect(totals.outputTokens).toBe(13);
    expect(totals.costUsd).toBeCloseTo(0.03, 5);
  });

  test("returns zeros for an empty session", () => {
    const totals = sessionTotals(createInitialState());
    expect(totals).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});

function treeNode(overrides: Partial<AgentTreeNode> & { agentId: string }): AgentTreeNode {
  return {
    parentAgentId: null,
    model: "sonnet",
    status: "waiting",
    children: [],
    ...overrides,
  };
}

describe("seedFromTree (Round 2 — fixes the fresh-session bootstrap deadlock)", () => {
  test("seeds rootAgentId/selectedAgentId from the tree entry with parentAgentId === null", () => {
    const state = createInitialState();
    const next = seedFromTree(state, [treeNode({ agentId: "agent-root" })]);
    expect(next.rootAgentId).toBe("agent-root");
    expect(next.selectedAgentId).toBe("agent-root");
    expect(next.agents.get("agent-root")).toMatchObject({
      agentId: "agent-root",
      parentAgentId: null,
      model: "sonnet",
      status: "waiting",
    });
  });

  test("does not hardcode an id — a differently-named root is still recognized as root", () => {
    const state = createInitialState();
    const next = seedFromTree(state, [treeNode({ agentId: "some-other-id-entirely" })]);
    expect(next.rootAgentId).toBe("some-other-id-entirely");
  });

  test("flattens nested children into the agents map", () => {
    const state = createInitialState();
    const next = seedFromTree(state, [
      treeNode({
        agentId: "root",
        children: [treeNode({ agentId: "child", parentAgentId: "root" })],
      }),
    ]);
    expect(next.agents.has("root")).toBe(true);
    expect(next.agents.has("child")).toBe(true);
    expect(next.agents.get("child")?.parentAgentId).toBe("root");
    // Only the parentless entry becomes root/selected, never a nested child.
    expect(next.rootAgentId).toBe("root");
  });

  test("an empty tree is a no-op", () => {
    const state = createInitialState();
    const next = seedFromTree(state, []);
    expect(next).toBe(state);
  });

  test("does not move rootAgentId/selectedAgentId once already set by an earlier agent_spawned", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null, "sonnet"));
    const next = seedFromTree(state, [treeNode({ agentId: "root-1" })]);
    expect(next.rootAgentId).toBe("root-1");
    expect(next.selectedAgentId).toBe("root-1");
  });

  test("does not clobber a known agent's live fields with the boot-time snapshot", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null, "sonnet"));
    state = applyEvent(state, statusEvent("root-1", "running"));
    state = applyEvent(state, output("root-1", "already streaming output"));

    // A stale/racing tree response claims root-1 is still "waiting" with no output — must
    // not overwrite what SSE already reported as more current.
    const next = seedFromTree(state, [treeNode({ agentId: "root-1", status: "waiting" })]);
    expect(next.agents.get("root-1")?.status).toBe("running");
    expect(next.agents.get("root-1")?.output).toBe("already streaming output");
  });

  test("is safe to call twice (idempotent) without duplicating or reordering agents", () => {
    const state = createInitialState();
    const once = seedFromTree(state, [treeNode({ agentId: "root-1" })]);
    const twice = seedFromTree(once, [treeNode({ agentId: "root-1" })]);
    expect(twice.agents.size).toBe(1);
    expect(orderedAgents(twice).map((a) => a.agentId)).toEqual(["root-1"]);
  });

  test("does not mutate the previous state object", () => {
    const state = createInitialState();
    const next = seedFromTree(state, [treeNode({ agentId: "root-1" })]);
    expect(state.agents.size).toBe(0);
    expect(next.agents.size).toBe(1);
  });
});
