import { describe, expect, test } from "bun:test";
import type {
  AgentOutputEvent,
  AgentSpawnedEvent,
  AgentStatusEvent,
  AgentTreeNode,
  ResyncEvent,
  SessionEndedEvent,
  TokenUsageEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "../contracts/index.ts";
import { initialState, MAX_OUTPUT_CHARS, reducer, visibleAutocomplete } from "./state.ts";
import type { TuiState } from "./types.type.ts";

function size() {
  return { rows: 24, cols: 80 };
}

function spawned(overrides: Partial<AgentSpawnedEvent> = {}): AgentSpawnedEvent {
  return {
    version: 1,
    id: "e1",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_spawned",
    agentId: "root",
    parentAgentId: null,
    model: "sonnet",
    ...overrides,
  };
}

function output(overrides: Partial<AgentOutputEvent> = {}): AgentOutputEvent {
  return {
    version: 1,
    id: "e2",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "root",
    chunk: "hi",
    ...overrides,
  };
}

function statusEvent(overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    version: 1,
    id: "e3",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_status",
    agentId: "root",
    status: "done",
    ...overrides,
  };
}

function tokenUsage(overrides: Partial<TokenUsageEvent> = {}): TokenUsageEvent {
  return {
    version: 1,
    id: "e4",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "token_usage",
    agentId: "root",
    inputTokens: 10,
    outputTokens: 20,
    ...overrides,
  };
}

function sessionEnded(overrides: Partial<SessionEndedEvent> = {}): SessionEndedEvent {
  return {
    version: 1,
    id: "e5",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "session_ended",
    exitCode: 0,
    ...overrides,
  };
}

function resync(overrides: Partial<ResyncEvent> = {}): ResyncEvent {
  return {
    version: 1,
    id: "e6",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "resync",
    ...overrides,
  };
}

function toolCall(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    version: 1,
    id: "e7",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "tool_call",
    agentId: "root",
    toolUseId: "tu_1",
    toolName: "Bash",
    inputSummary: "echo hi",
    ...overrides,
  };
}

function toolResult(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    version: 1,
    id: "e8",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "tool_result",
    agentId: "root",
    toolUseId: "tu_1",
    toolName: "Bash",
    isError: false,
    durationMs: 12,
    ...overrides,
  };
}

function treeNode(
  agentId: string,
  children: AgentTreeNode[] = [],
  parentAgentId: string | null = null,
): AgentTreeNode {
  return { agentId, parentAgentId, model: "sonnet", status: "running", children };
}

describe("initialState", () => {
  test("starts on the root view, disconnected agents, connecting", () => {
    const state = initialState(size());
    expect(state.view).toEqual({ kind: "root" });
    expect(state.agents.size).toBe(0);
    expect(state.rootAgentId).toBeNull();
    expect(state.tree).toBeNull();
    expect(state.input).toBe("");
    expect(state.connection).toBe("connecting");
    expect(state.sessionEnded).toBeNull();
    expect(state.statusMessage).toBeNull();
    expect(state.size).toEqual(size());
  });
});

describe("reducer: sse_event agent_spawned", () => {
  test("sets rootAgentId on the first root-level spawn", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    });
    expect(state.rootAgentId).toBe("root");
    expect(state.agents.get("root")?.model).toBe("sonnet");
  });

  test("does not overwrite an already-known rootAgentId", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "other-root", parentAgentId: null }),
    }));
    expect(state.rootAgentId).toBe("root");
  });

  test("a non-root spawn does not set rootAgentId", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: spawned({ agentId: "child", parentAgentId: "root" }),
    });
    expect(state.rootAgentId).toBeNull();
    expect(state.agents.get("child")?.parentAgentId).toBe("root");
  });

  test("tracks agent creation order", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "a" }) }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "b", parentAgentId: "a" }),
    }));
    expect(state.agentOrder).toEqual(["a", "b"]);
  });
});

describe("reducer: sse_event agent_output", () => {
  test("creates the agent on first output and appends the chunk", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: output({ agentId: "root", chunk: "hello" }),
    });
    expect(state.agents.get("root")?.transcript).toEqual([{ role: "assistant", text: "hello" }]);
    expect(state.agents.get("root")?.status).toBe("waiting");
  });

  test("appends across multiple events into a single assistant turn", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: output({ chunk: "a" }) }));
    ({ state } = reducer(state, { type: "sse_event", event: output({ chunk: "b" }) }));
    expect(state.agents.get("root")?.transcript).toEqual([{ role: "assistant", text: "ab" }]);
  });

  test("caps transcript at MAX_OUTPUT_CHARS total, keeping the tail", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: output({ chunk: "x".repeat(MAX_OUTPUT_CHARS) }),
    }));
    ({ state } = reducer(state, { type: "sse_event", event: output({ chunk: "TAIL" }) }));
    const transcript = state.agents.get("root")?.transcript ?? [];
    const totalChars = transcript.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(totalChars).toBe(MAX_OUTPUT_CHARS);
    const lastTurn = transcript[transcript.length - 1];
    expect(lastTurn?.text.endsWith("TAIL")).toBe(true);
  });

  test("capping fully drops an older, smaller turn rather than only trimming the newest one", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    state = { ...state, input: "small" };
    ({ state } = reducer(state, { type: "key", key: { kind: "enter" } }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: output({ agentId: "root", chunk: "x".repeat(MAX_OUTPUT_CHARS) }),
    }));
    const transcript = state.agents.get("root")?.transcript ?? [];
    // The 5-char "small" user turn is entirely evicted, leaving just the assistant turn.
    expect(transcript).toEqual([{ role: "assistant", text: "x".repeat(MAX_OUTPUT_CHARS) }]);
  });
});

describe("reducer: sse_event agent_status", () => {
  test("creates the agent if missing and sets status", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: statusEvent({ agentId: "root", status: "failed" }),
    });
    expect(state.agents.get("root")?.status).toBe("failed");
  });

  test("updates status on an existing agent without clobbering other fields", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", model: "sonnet" }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ agentId: "root", status: "done" }),
    }));
    const agent = state.agents.get("root");
    expect(agent?.status).toBe("done");
    expect(agent?.model).toBe("sonnet");
  });

  test("DH-0130: transitioning into a terminal status appends a transcript marker tagged with terminalStatus", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "sub", parentAgentId: "root" }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ agentId: "sub", status: "failed" }),
    }));
    const transcript = state.agents.get("sub")?.transcript ?? [];
    const marker = transcript[transcript.length - 1];
    expect(marker?.role).toBe("tool");
    expect(marker?.terminalStatus).toBe("failed");
  });

  test("DH-0130: re-sending the same terminal status does not append a duplicate marker", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "sub", parentAgentId: "root" }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ agentId: "sub", status: "done" }),
    }));
    const countAfterFirst = state.agents.get("sub")?.transcript.length ?? 0;
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ agentId: "sub", status: "done" }),
    }));
    expect(state.agents.get("sub")?.transcript.length).toBe(countAfterFirst);
  });

  test("DH-0130: a non-terminal status transition (e.g. waiting -> running) appends no marker", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "sub", parentAgentId: "root" }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ agentId: "sub", status: "running" }),
    }));
    expect(state.agents.get("sub")?.transcript.length).toBe(0);
  });
});

describe("reducer: sse_event agent_thinking (DH-0045 exhaustiveness case)", () => {
  test("is a no-op — full TUI display is a later round", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "root" }) }));
    const before = state;
    ({ state } = reducer(state, {
      type: "sse_event",
      event: {
        version: 1,
        id: "e9",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "agent_thinking",
        agentId: "root",
        chunk: "reasoning...",
      },
    }));
    expect(state).toBe(before);
  });
});

describe("reducer: sse_event tool_call / tool_result (DH-0089)", () => {
  test("tool_call appends a tool marker turn and records it pending; a successful tool_result leaves it unchanged", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "root" }) }));
    ({ state } = reducer(state, { type: "sse_event", event: toolCall() }));
    let agent = state.agents.get("root");
    expect(agent?.transcript).toEqual([{ role: "tool", text: "Bash: echo hi" }]);
    expect(agent?.pendingToolCall).toEqual({ toolUseId: "tu_1", turnIndex: 0 });

    ({ state } = reducer(state, { type: "sse_event", event: toolResult({ isError: false }) }));
    agent = state.agents.get("root");
    expect(agent?.transcript).toEqual([{ role: "tool", text: "Bash: echo hi" }]);
    expect(agent?.pendingToolCall).toBeNull();
  });

  test("a failed tool_result marks the pending marker turn errored instead of adding a new one", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "root" }) }));
    ({ state } = reducer(state, { type: "sse_event", event: toolCall() }));
    ({ state } = reducer(state, { type: "sse_event", event: toolResult({ isError: true }) }));
    const agent = state.agents.get("root");
    expect(agent?.transcript).toEqual([{ role: "tool", text: "Bash: echo hi", toolError: true }]);
    expect(agent?.pendingToolCall).toBeNull();
  });

  test("toolName Agent is suppressed at tool_call time; a failed tool_result still renders standalone", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "root" }) }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: toolCall({ toolName: "Agent", inputSummary: "spawn sonnet" }),
    }));
    expect(state.agents.get("root")?.transcript).toEqual([]);

    ({ state } = reducer(state, {
      type: "sse_event",
      event: toolResult({ toolName: "Agent", isError: true }),
    }));
    expect(state.agents.get("root")?.transcript).toEqual([{ role: "tool", text: "Agent ✗" }]);
  });

  test("an unmatched tool_result (resume gap) drops silently on success, renders standalone on error", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "sse_event", event: spawned({ agentId: "root" }) }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: toolResult({ toolUseId: "unknown", isError: false }),
    }));
    expect(state.agents.get("root")?.transcript).toEqual([]);

    ({ state } = reducer(state, {
      type: "sse_event",
      event: toolResult({ toolUseId: "unknown-2", isError: true }),
    }));
    expect(state.agents.get("root")?.transcript).toEqual([{ role: "tool", text: "Bash ✗" }]);
  });
});

describe("reducer: liveness — lastEventAt / statusSince", () => {
  test("lastEventAt is set from the event's timestamp on every event type", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: spawned({ timestamp: "2026-07-15T00:00:10.000Z" }),
    });
    expect(state.agents.get("root")?.lastEventAt).toBe(Date.parse("2026-07-15T00:00:10.000Z"));
  });

  test("agent_output bumps lastEventAt but never statusSince", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ timestamp: "2026-07-15T00:00:00.000Z" }),
    }));
    const statusSinceAfterSpawn = state.agents.get("root")?.statusSince;
    ({ state } = reducer(state, {
      type: "sse_event",
      event: output({ timestamp: "2026-07-15T00:00:20.000Z", chunk: "hi" }),
    }));
    const agent = state.agents.get("root");
    expect(agent?.lastEventAt).toBe(Date.parse("2026-07-15T00:00:20.000Z"));
    expect(agent?.statusSince).toBe(statusSinceAfterSpawn);
  });

  test("a status change bumps statusSince; an unchanged status does not", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ status: "running", timestamp: "2026-07-15T00:00:00.000Z" }),
    }));
    const firstStatusSince = state.agents.get("root")?.statusSince;
    // Same status again, later timestamp: statusSince must not move.
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ status: "running", timestamp: "2026-07-15T00:00:30.000Z" }),
    }));
    expect(state.agents.get("root")?.statusSince).toBe(firstStatusSince);
    // A genuine status change moves statusSince to that event's timestamp.
    ({ state } = reducer(state, {
      type: "sse_event",
      event: statusEvent({ status: "done", timestamp: "2026-07-15T00:01:00.000Z" }),
    }));
    expect(state.agents.get("root")?.statusSince).toBe(Date.parse("2026-07-15T00:01:00.000Z"));
  });

  test("falls back to Date.now() for an unparseable timestamp instead of throwing", () => {
    const before = Date.now();
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: spawned({ timestamp: "not-a-date" }),
    });
    const after = Date.now();
    const lastEventAt = state.agents.get("root")?.lastEventAt ?? -1;
    expect(lastEventAt).toBeGreaterThanOrEqual(before);
    expect(lastEventAt).toBeLessThanOrEqual(after);
  });
});

describe("reducer: sse_event token_usage", () => {
  test("sets token counts and costUsd when present", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 5, outputTokens: 7, costUsd: 0.5 }),
    });
    const agent = state.agents.get("root");
    expect(agent?.inputTokens).toBe(5);
    expect(agent?.outputTokens).toBe(7);
    expect(agent?.costUsd).toBe(0.5);
  });

  test("defaults costUsd to null when absent", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: tokenUsage({}),
    });
    expect(state.agents.get("root")?.costUsd).toBeNull();
  });

  test("DH-0028: accumulates (sums) across multiple events, rather than replacing", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 5, outputTokens: 7, costUsd: 0.5 }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 3, outputTokens: 2, costUsd: 0.25 }),
    }));
    const agent = state.agents.get("root");
    expect(agent?.inputTokens).toBe(8);
    expect(agent?.outputTokens).toBe(9);
    expect(agent?.costUsd).toBeCloseTo(0.75);
  });

  test("cost stays null across accumulation when no event ever reports a cost", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 5, outputTokens: 7 }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 3, outputTokens: 2 }),
    }));
    const agent = state.agents.get("root");
    expect(agent?.inputTokens).toBe(8);
    expect(agent?.costUsd).toBeNull();
  });

  test("cost becomes known once any event reports it, even if a later event omits it", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 5, outputTokens: 7, costUsd: 0.5 }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: tokenUsage({ inputTokens: 3, outputTokens: 2 }),
    }));
    expect(state.agents.get("root")?.costUsd).toBeCloseTo(0.5);
  });
});

describe("reducer: DH-0012 completed-agent eviction", () => {
  function statusAgent(
    agentId: string,
    status: "running" | "done" | "failed" | "stopped" | "waiting",
  ) {
    return statusEvent({ agentId, status });
  }

  test("terminal agents beyond the retention cap are evicted, oldest first", () => {
    let state = initialState(size());
    // Spawn and complete 60 agents; only the most-recent 50 terminal entries should survive.
    for (let i = 0; i < 60; i++) {
      const agentId = `agent-${i}`;
      ({ state } = reducer(state, {
        type: "sse_event",
        event: spawned({ agentId, timestamp: "2026-07-15T00:00:00.000Z" }),
      }));
      ({ state } = reducer(state, { type: "sse_event", event: statusAgent(agentId, "done") }));
    }
    expect(state.agents.size).toBe(50);
    expect(state.agents.has("agent-0")).toBe(false);
    expect(state.agents.has("agent-9")).toBe(false);
    expect(state.agents.has("agent-10")).toBe(true);
    expect(state.agents.has("agent-59")).toBe(true);
    expect(state.agentOrder).toHaveLength(50);
  });

  test("active (non-terminal) agents are never evicted regardless of count", () => {
    let state = initialState(size());
    for (let i = 0; i < 60; i++) {
      const agentId = `agent-${i}`;
      ({ state } = reducer(state, {
        type: "sse_event",
        event: spawned({ agentId, timestamp: "2026-07-15T00:00:00.000Z" }),
      }));
      // Leave every agent "running" (non-terminal) — none should ever be evicted.
      ({ state } = reducer(state, { type: "sse_event", event: statusAgent(agentId, "running") }));
    }
    expect(state.agents.size).toBe(60);
  });

  test("failed and stopped both count as terminal for eviction purposes", () => {
    let state = initialState(size());
    for (let i = 0; i < 55; i++) {
      const agentId = `agent-${i}`;
      ({ state } = reducer(state, {
        type: "sse_event",
        event: spawned({ agentId, timestamp: "2026-07-15T00:00:00.000Z" }),
      }));
      const status = i % 2 === 0 ? "failed" : "stopped";
      ({ state } = reducer(state, { type: "sse_event", event: statusAgent(agentId, status) }));
    }
    expect(state.agents.size).toBe(50);
  });

  test("under the retention cap, nothing is evicted", () => {
    let state = initialState(size());
    for (let i = 0; i < 10; i++) {
      const agentId = `agent-${i}`;
      ({ state } = reducer(state, {
        type: "sse_event",
        event: spawned({ agentId, timestamp: "2026-07-15T00:00:00.000Z" }),
      }));
      ({ state } = reducer(state, { type: "sse_event", event: statusAgent(agentId, "done") }));
    }
    expect(state.agents.size).toBe(10);
  });
});

describe("reducer: sse_event session_ended", () => {
  test("records the exit code", () => {
    const { state } = reducer(initialState(size()), {
      type: "sse_event",
      event: sessionEnded({ exitCode: 1 }),
    });
    expect(state.sessionEnded).toEqual({ exitCode: 1 });
  });
});

describe("reducer: tree_response", () => {
  test("sets the tree even when not viewing it", () => {
    const tree = [treeNode("root")];
    const { state } = reducer(initialState(size()), { type: "tree_response", tree });
    expect(state.tree).toBe(tree);
    expect(state.view).toEqual({ kind: "root" });
  });

  test("leaves selectedIndex unchanged when it's within range", () => {
    let state = initialState(size());
    state = { ...state, view: { kind: "tree", selectedIndex: 1 } };
    const tree = [treeNode("a"), treeNode("b"), treeNode("c")];
    const { state: next } = reducer(state, { type: "tree_response", tree });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 1 });
  });

  test("clamps selectedIndex down when the new tree is shorter", () => {
    let state = initialState(size());
    state = { ...state, view: { kind: "tree", selectedIndex: 5 } };
    const tree = [treeNode("a"), treeNode("b")];
    const { state: next } = reducer(state, { type: "tree_response", tree });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 1 });
  });

  test("clamps to 0 when the new tree is empty", () => {
    let state = initialState(size());
    state = { ...state, view: { kind: "tree", selectedIndex: 5 } };
    const { state: next } = reducer(state, { type: "tree_response", tree: [] });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 0 });
  });

  // Round 3 (docs/handoffs/tui.md): a fresh session must be able to send its first message
  // without ever seeing a live agent_spawned event, or it deadlocks — agent_spawned never
  // fires until the loop starts, which requires a first message, which requires a known
  // rootAgentId. Seeding rootAgentId from the startup tree fetch breaks that cycle.
  test("seeds rootAgentId from the tree's root node (parentAgentId === null) when not already known", () => {
    const tree = [treeNode("agent-root")];
    const { state } = reducer(initialState(size()), { type: "tree_response", tree });
    expect(state.rootAgentId).toBe("agent-root");
  });

  test("does not overwrite an already-known rootAgentId from a later tree response", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    const { state: next } = reducer(state, {
      type: "tree_response",
      tree: [treeNode("other-root")],
    });
    expect(next.rootAgentId).toBe("root");
  });

  test("identifies the root by parentAgentId === null, not by array position", () => {
    const root = treeNode("root-id");
    const nonRoot = treeNode("weird-first-entry", [], "root-id");
    const { state } = reducer(initialState(size()), {
      type: "tree_response",
      tree: [nonRoot, root],
    });
    expect(state.rootAgentId).toBe("root-id");
  });

  test("leaves rootAgentId null when no entry has a null parentAgentId", () => {
    const tree = [treeNode("x", [], "y")];
    const { state } = reducer(initialState(size()), { type: "tree_response", tree });
    expect(state.rootAgentId).toBeNull();
  });

  test("seeding rootAgentId unblocks sending the first message via 'enter'", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "tree_response",
      tree: [treeNode("agent-root")],
    }));
    state = { ...state, input: "hello" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.statusMessage).not.toBe("No root agent yet — please wait.");
    expect(effects).toEqual([
      {
        type: "send_command",
        command: { type: "send_message", agentId: "agent-root", message: "hello" },
      },
    ]);
  });
});

describe("reducer: command_error / resize / connection", () => {
  test("command_error sets statusMessage", () => {
    const { state } = reducer(initialState(size()), { type: "command_error", error: "boom" });
    expect(state.statusMessage).toBe("boom");
  });

  test("resize updates size", () => {
    const { state } = reducer(initialState(size()), { type: "resize", rows: 40, cols: 120 });
    expect(state.size).toEqual({ rows: 40, cols: 120 });
  });

  test("tick updates now with an injected clock value (no real sleep needed)", () => {
    const { state } = reducer(initialState(size()), { type: "tick", now: 999_999 });
    expect(state.now).toBe(999_999);
  });

  test("connection updates connection status", () => {
    const { state } = reducer(initialState(size()), { type: "connection", status: "live" });
    expect(state.connection).toBe("live");
  });

  test("reconnected sets a visible notice that history may be incomplete (DH-0024)", () => {
    const { state, effects } = reducer(initialState(size()), { type: "reconnected" });
    expect(state.reconnectNotice).toBe("Reconnected — history may be incomplete.");
    expect(effects).toEqual([]);
  });

  test("a server-detected resync event sets the same reconnect notice (DH-0019)", () => {
    const { state, effects } = reducer(initialState(size()), {
      type: "sse_event",
      event: resync(),
    });
    expect(state.reconnectNotice).toBe("Reconnected — history may be incomplete.");
    expect(effects).toEqual([]);
  });
});

describe("reducer: key handling — global", () => {
  test("ctrl_c produces a quit effect from any view", () => {
    const { effects } = reducer(initialState(size()), { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
  });

  test("ctrl_c from the tree view also produces a quit effect", () => {
    let state = initialState(size());
    state = { ...state, view: { kind: "tree", selectedIndex: 0 } };
    const { effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
  });

  // DH-0059: ownsServer: true changes Ctrl+C from an unconditional quit into a graceful
  // stop_agent/session_ended handshake — but only once the root has actually done something.
  test("ctrl_c with ownsServer: true but a root that was never active quits immediately (no stop_agent)", () => {
    const state = initialState(size(), { ownsServer: true });
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
    expect(next.shutdownRequested).toBe(false);
  });

  test("ctrl_c with ownsServer: true and rootAgentId unknown quits immediately", () => {
    let state = initialState(size(), { ownsServer: true });
    state = { ...state, rootActive: true }; // rootAgentId still null
    const { effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
  });

  test("ctrl_c with ownsServer: true and an already-ended session quits immediately", () => {
    let state = initialState(size(), { ownsServer: true });
    state = {
      ...state,
      rootAgentId: "agent-root",
      rootActive: true,
      sessionEnded: { exitCode: 0 },
    };
    const { effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
  });

  test("ctrl_c with ownsServer: true and an active root sends stop_agent and sets shutdownRequested", () => {
    let state = initialState(size(), { ownsServer: true });
    state = { ...state, rootAgentId: "agent-root", rootActive: true };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([
      { type: "send_command", command: { type: "stop_agent", agentId: "agent-root" } },
    ]);
    expect(next.shutdownRequested).toBe(true);
    expect(next.statusMessage).toBe("stopping session… (Ctrl+C again to force quit)");
  });

  test("a second ctrl_c while shutdownRequested is already set force-quits immediately", () => {
    let state = initialState(size(), { ownsServer: true });
    state = {
      ...state,
      rootAgentId: "agent-root",
      rootActive: true,
      shutdownRequested: true,
    };
    const { effects } = reducer(state, { type: "key", key: { kind: "ctrl_c" } });
    expect(effects).toEqual([{ type: "quit" }]);
  });

  test("agent_spawned for the root marks rootActive true", () => {
    const { state } = reducer(initialState(size()), { type: "sse_event", event: spawned() });
    expect(state.rootActive).toBe(true);
  });

  test("agent_output for a non-root agent does not mark rootActive", () => {
    let state = initialState(size());
    state = { ...state, rootAgentId: "agent-root" };
    const { state: next } = reducer(state, {
      type: "sse_event",
      event: {
        version: 1,
        id: "e2",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "agent_output",
        agentId: "some-other-agent",
        chunk: "hi",
      },
    });
    expect(next.rootActive).toBe(false);
  });

  test("sending a message from the root view marks rootActive true", () => {
    let state = initialState(size());
    state = {
      ...state,
      rootAgentId: "agent-root",
      input: "hello",
      inputCursor: 5,
    };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.rootActive).toBe(true);
  });

  test("session_ended while shutdownRequested emits a deferred quit effect", () => {
    let state = initialState(size(), { ownsServer: true });
    state = { ...state, rootAgentId: "agent-root", rootActive: true, shutdownRequested: true };
    const { state: next, effects } = reducer(state, {
      type: "sse_event",
      event: {
        version: 1,
        id: "e3",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "session_ended",
        exitCode: 0,
      },
    });
    expect(next.sessionEnded).toEqual({ exitCode: 0 });
    expect(effects).toEqual([{ type: "quit", afterMs: 1000 }]);
  });

  test("session_ended with no shutdown in progress does not emit a quit effect", () => {
    const { effects } = reducer(initialState(size()), {
      type: "sse_event",
      event: {
        version: 1,
        id: "e4",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "session_ended",
        exitCode: 0,
      },
    });
    expect(effects).toEqual([]);
  });
});

describe("reducer: key handling — root view", () => {
  test("left-arrow on empty input opens the tree and requests it", () => {
    const { state, effects } = reducer(initialState(size()), {
      type: "key",
      key: { kind: "left" },
    });
    expect(state.view).toEqual({ kind: "tree", selectedIndex: 0 });
    expect(effects).toEqual([{ type: "send_command", command: { type: "request_agent_tree" } }]);
  });

  test("left-arrow with non-empty input moves the cursor left instead of opening the tree", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 2 };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "left" } });
    expect(next.view).toEqual({ kind: "root" });
    expect(next.inputCursor).toBe(1);
    expect(effects).toEqual([]);
  });

  test("left-arrow clamps the cursor at the start of the input", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 0 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "left" } });
    expect(next.inputCursor).toBe(0);
  });

  test("right-arrow moves the cursor right within the input (previously a dead key)", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 0 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "right" } });
    expect(next.inputCursor).toBe(1);
  });

  test("right-arrow clamps the cursor at the end of the input", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 2 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "right" } });
    expect(next.inputCursor).toBe(2);
  });

  test("home moves the cursor to the start of the input", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 2 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "home" } });
    expect(next.inputCursor).toBe(0);
  });

  test("end moves the cursor to the end of the input", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 0 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "end" } });
    expect(next.inputCursor).toBe(2);
  });

  test("typing characters appends to input and advances the cursor", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "h" } }));
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "i" } }));
    expect(state.input).toBe("hi");
    expect(state.inputCursor).toBe(2);
  });

  test("typing a character mid-string inserts at the cursor rather than appending", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 1 };
    const { state: next } = reducer(state, {
      type: "key",
      key: { kind: "char", value: "X" },
    });
    expect(next.input).toBe("hXi");
    expect(next.inputCursor).toBe(2);
  });

  test("delete removes the character at the cursor, not before it", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 0 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "delete" } });
    expect(next.input).toBe("i");
    expect(next.inputCursor).toBe(0);
  });

  test("delete at the end of the input is a no-op", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 2 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "delete" } });
    expect(next.input).toBe("hi");
  });

  test("escape in the root view clears both statusMessage and reconnectNotice", () => {
    let state = initialState(size());
    state = {
      ...state,
      statusMessage: "stale",
      reconnectNotice: "Reconnected — history may be incomplete.",
    };
    const { state: next } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.statusMessage).toBeNull();
    expect(next.reconnectNotice).toBeNull();
  });

  test("DH-0211: escape with an active running root agent sends stop_agent instead of quitting", () => {
    let state = initialState(size());
    state = {
      ...state,
      rootAgentId: "agent-root",
      rootActive: true,
      statusMessage: "stale",
      reconnectNotice: "Reconnected — history may be incomplete.",
    };
    const withAgentInfo = reducer(state, {
      type: "sse_event",
      event: {
        type: "agent_spawned",
        agentId: "agent-root",
        parentAgentId: null,
        model: "claude",
        timestamp: new Date().toISOString(),
      },
    }).state;
    const { state: next, effects } = reducer(withAgentInfo, {
      type: "key",
      key: { kind: "escape" },
    });
    expect(effects).toEqual([
      { type: "send_command", command: { type: "stop_agent", agentId: "agent-root" } },
    ]);
    expect(next.statusMessage).toBe("stopping…");
    expect(next.reconnectNotice).toBeNull();
  });

  test("DH-0211: escape with a terminal-status root agent falls back to clearing messages (no stop_agent)", () => {
    let state = initialState(size());
    state = { ...state, rootAgentId: "agent-root", rootActive: true, statusMessage: "stale" };
    const withStatus = reducer(state, {
      type: "sse_event",
      event: {
        type: "agent_status",
        agentId: "agent-root",
        status: "done",
        timestamp: new Date().toISOString(),
      },
    }).state;
    const { state: next, effects } = reducer(withStatus, {
      type: "key",
      key: { kind: "escape" },
    });
    expect(effects).toEqual([]);
    expect(next.statusMessage).toBeNull();
  });

  test("DH-0211: escape after session_ended falls back to clearing messages (no stop_agent)", () => {
    let state = initialState(size());
    state = {
      ...state,
      rootAgentId: "agent-root",
      rootActive: true,
      sessionEnded: { exitCode: 0 },
      statusMessage: "stale",
    };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(effects).toEqual([]);
    expect(next.statusMessage).toBeNull();
  });

  test("tab is an intentional no-op in the root view (previously a dead key)", () => {
    const state = initialState(size());
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "tab" } });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  test("a bracketed paste inserts its literal text at the cursor, including newlines", () => {
    let state = initialState(size());
    state = { ...state, input: "ac", inputCursor: 1 };
    const { state: next, effects } = reducer(state, {
      type: "key",
      key: { kind: "paste", text: "line1\nline2" },
    });
    expect(next.input).toBe("aline1\nline2c");
    expect(next.inputCursor).toBe(1 + "line1\nline2".length);
    // A paste never sends anything on its own — only Enter does.
    expect(effects).toEqual([]);
  });

  test("a multi-line paste is not fragmented: enter is only sent once the operator presses it", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    ({ state } = reducer(state, {
      type: "key",
      key: { kind: "paste", text: "first line\nsecond line" },
    }));
    expect(state.input).toBe("first line\nsecond line");
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.input).toBe("");
    expect(next.inputCursor).toBe(0);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual({
      type: "send_command",
      command: {
        type: "send_message",
        agentId: "root",
        message: "first line\nsecond line",
      },
    });
  });

  test("backspace removes the character before the cursor", () => {
    let state = initialState(size());
    state = { ...state, input: "hi", inputCursor: 2 };
    const { state: next } = reducer(state, { type: "key", key: { kind: "backspace" } });
    expect(next.input).toBe("h");
    expect(next.inputCursor).toBe(1);
  });

  test("backspace on empty input stays empty", () => {
    const { state } = reducer(initialState(size()), { type: "key", key: { kind: "backspace" } });
    expect(state.input).toBe("");
  });

  test("enter with blank/whitespace-only input is a no-op", () => {
    let state = initialState(size());
    state = { ...state, input: "   " };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.input).toBe("   ");
    expect(effects).toEqual([]);
  });

  test("enter with input but no known root agent sets a status message", () => {
    let state = initialState(size());
    state = { ...state, input: "hello" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.statusMessage).toBe("No root agent yet — please wait.");
    expect(next.input).toBe("hello");
    expect(effects).toEqual([]);
  });

  test("enter with input and a known root agent sends send_message and clears input", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    state = { ...state, input: "hello", statusMessage: "stale" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.input).toBe("");
    expect(next.statusMessage).toBeNull();
    expect(effects).toEqual([
      {
        type: "send_command",
        command: { type: "send_message", agentId: "root", message: "hello" },
      },
    ]);
  });

  test("enter immediately appends the sent message as a user turn, before any server response", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    state = { ...state, input: "hello there" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.agents.get("root")?.transcript).toEqual([{ role: "user", text: "hello there" }]);
  });

  test("a sent user turn never merges with a preceding assistant turn", () => {
    let state = initialState(size());
    ({ state } = reducer(state, {
      type: "sse_event",
      event: spawned({ agentId: "root", parentAgentId: null }),
    }));
    ({ state } = reducer(state, {
      type: "sse_event",
      event: output({ agentId: "root", chunk: "earlier reply" }),
    }));
    state = { ...state, input: "follow up" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.agents.get("root")?.transcript).toEqual([
      { role: "assistant", text: "earlier reply" },
      { role: "user", text: "follow up" },
    ]);
  });

  test("escape clears the status message", () => {
    let state = initialState(size());
    state = { ...state, statusMessage: "oops" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.statusMessage).toBeNull();
  });

  test("an unhandled key (e.g. up-arrow) in root view is a no-op", () => {
    const { state, effects } = reducer(initialState(size()), { type: "key", key: { kind: "up" } });
    expect(state.view).toEqual({ kind: "root" });
    expect(effects).toEqual([]);
  });
});

describe("reducer: key handling — tree view", () => {
  function treeState(tree: AgentTreeNode[], selectedIndex = 0): TuiState {
    let state = initialState(size());
    state = { ...state, tree, view: { kind: "tree", selectedIndex } };
    return state;
  }

  test("up-arrow moves selection up, clamped at 0", () => {
    const state = treeState([treeNode("a"), treeNode("b")], 1);
    const { state: next } = reducer(state, { type: "key", key: { kind: "up" } });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 0 });
    const { state: clamped } = reducer(next, { type: "key", key: { kind: "up" } });
    expect(clamped.view).toEqual({ kind: "tree", selectedIndex: 0 });
  });

  test("down-arrow moves selection down, clamped at the last entry", () => {
    const state = treeState([treeNode("a"), treeNode("b")], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "down" } });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 1 });
    const { state: clamped } = reducer(next, { type: "key", key: { kind: "down" } });
    expect(clamped.view).toEqual({ kind: "tree", selectedIndex: 1 });
  });

  test("down-arrow on an empty tree stays at 0", () => {
    const state = treeState([], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "down" } });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 0 });
  });

  test("enter on a non-root agent opens its read-only view", () => {
    const state = treeState([treeNode("a"), treeNode("b")], 1);
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.view).toEqual({ kind: "agent", agentId: "b" });
  });

  test("enter on the root agent switches to the root view", () => {
    let state = treeState([treeNode("root"), treeNode("b")], 0);
    state = { ...state, rootAgentId: "root" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.view).toEqual({ kind: "root" });
  });

  test("enter with no entry at the selected index is a no-op", () => {
    const state = treeState([], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 0 });
  });

  test("left-arrow returns to the root view", () => {
    const state = treeState([treeNode("a")], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "left" } });
    expect(next.view).toEqual({ kind: "root" });
  });

  test("escape returns to the root view", () => {
    const state = treeState([treeNode("a")], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.view).toEqual({ kind: "root" });
  });

  test("an unhandled key (e.g. a character) in tree view is a no-op", () => {
    const state = treeState([treeNode("a")], 0);
    const { state: next } = reducer(state, { type: "key", key: { kind: "char", value: "x" } });
    expect(next.view).toEqual({ kind: "tree", selectedIndex: 0 });
  });
});

describe("reducer: key handling — agent view", () => {
  function agentViewState(agentId: string): TuiState {
    let state = initialState(size());
    state = { ...state, view: { kind: "agent", agentId } };
    return state;
  }

  test("escape returns to the root view", () => {
    const state = agentViewState("child");
    const { state: next } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.view).toEqual({ kind: "root" });
  });

  test("'q' returns to the root view", () => {
    const state = agentViewState("child");
    const { state: next } = reducer(state, {
      type: "key",
      key: { kind: "char", value: "q" },
    });
    expect(next.view).toEqual({ kind: "root" });
  });

  test("other characters are a no-op (read-only view)", () => {
    const state = agentViewState("child");
    const { state: next } = reducer(state, {
      type: "key",
      key: { kind: "char", value: "x" },
    });
    expect(next.view).toEqual({ kind: "agent", agentId: "child" });
  });

  test("an unrelated key kind is a no-op", () => {
    const state = agentViewState("child");
    const { state: next } = reducer(state, { type: "key", key: { kind: "up" } });
    expect(next.view).toEqual({ kind: "agent", agentId: "child" });
  });
});

describe("reducer: slash commands (DH-0093)", () => {
  function rootedState(input: string): TuiState {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "tree_response", tree: [treeNode("root")] }));
    return { ...state, input };
  }

  test("/help before a root agent exists shows help via statusMessage, not a transcript entry", () => {
    const { state: next, effects } = reducer(
      { ...initialState(size()), input: "/help" },
      { type: "key", key: { kind: "enter" } },
    );
    expect(effects).toEqual([]);
    expect(next.statusMessage).toContain("/model [name]");
    expect(next.statusMessage).toContain("does NOT reset");
  });

  test("/help with a root agent renders a local tool-marker transcript entry and sends nothing", () => {
    const { state: next, effects } = reducer(rootedState("/help"), {
      type: "key",
      key: { kind: "enter" },
    });
    expect(effects).toEqual([]);
    const transcript = next.agents.get("root")?.transcript ?? [];
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.role).toBe("tool");
    expect(transcript[0]?.text).toContain("/clear");
    expect(next.input).toBe("");
  });

  test("/help lists cached skill commands", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "skills_response",
      skills: [{ name: "sm", description: "Sugar Maple filestore" }],
    }));
    state = { ...state, input: "/help" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    const transcript = next.agents.get("root")?.transcript ?? [];
    expect(transcript[0]?.text).toContain("/sm   Sugar Maple filestore");
  });

  test("/clear empties every tracked agent's transcript and sends nothing", () => {
    let state = rootedState("hi");
    ({ state } = reducer(state, { type: "key", key: { kind: "enter" } }));
    expect(state.agents.get("root")?.transcript.length).toBeGreaterThan(0);
    state = { ...state, input: "/clear" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(effects).toEqual([]);
    expect(next.agents.get("root")?.transcript).toEqual([]);
  });

  test("/model with no root agent yet reports the standard 'please wait' message", () => {
    const { state: next, effects } = reducer(
      { ...initialState(size()), input: "/model" },
      { type: "key", key: { kind: "enter" } },
    );
    expect(effects).toEqual([]);
    expect(next.statusMessage).toBe("No root agent yet — please wait.");
  });

  test("/model with no args sends list_models", () => {
    const { state: next, effects } = reducer(rootedState("/model"), {
      type: "key",
      key: { kind: "enter" },
    });
    expect(effects).toEqual([{ type: "send_command", command: { type: "list_models" } }]);
    expect(next.input).toBe("");
  });

  test("/model <name> switches directly, skipping the picker", () => {
    const { state: next, effects } = reducer(rootedState("/model sonnet"), {
      type: "key",
      key: { kind: "enter" },
    });
    expect(effects).toEqual([
      {
        type: "send_command",
        command: { type: "switch_model", agentId: "root", model: "sonnet" },
      },
    ]);
    expect(next.view).toEqual({ kind: "root" });
    expect(next.statusMessage).toContain("switching model to sonnet");
  });

  test("models_response transitions into the picker view, selecting the active model", () => {
    const { state: next } = reducer(rootedState(""), {
      type: "models_response",
      models: [
        {
          name: "haiku",
          provider: "anthropic",
          model: "claude-haiku",
          isDefault: false,
          isActive: false,
        },
        {
          name: "sonnet",
          provider: "anthropic",
          model: "claude-sonnet",
          isDefault: true,
          isActive: true,
        },
      ],
    });
    expect(next.view).toEqual({
      kind: "picker",
      options: [
        {
          name: "haiku",
          provider: "anthropic",
          model: "claude-haiku",
          isDefault: false,
          isActive: false,
        },
        {
          name: "sonnet",
          provider: "anthropic",
          model: "claude-sonnet",
          isDefault: true,
          isActive: true,
        },
      ],
      selectedIndex: 1,
    });
  });

  test("picker: up/down move selection, clamped to bounds", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "models_response",
      models: [
        { name: "a", provider: "p", model: "m", isDefault: false, isActive: true },
        { name: "b", provider: "p", model: "m", isDefault: false, isActive: false },
      ],
    }));
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    expect(state.view).toMatchObject({ selectedIndex: 1 });
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    expect(state.view).toMatchObject({ selectedIndex: 1 });
    ({ state } = reducer(state, { type: "key", key: { kind: "up" } }));
    ({ state } = reducer(state, { type: "key", key: { kind: "up" } }));
    expect(state.view).toMatchObject({ selectedIndex: 0 });
  });

  test("picker: enter sends switch_model for the selected row and returns to root", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "models_response",
      models: [
        { name: "a", provider: "p", model: "m", isDefault: false, isActive: true },
        { name: "b", provider: "p", model: "m", isDefault: false, isActive: false },
      ],
    }));
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.view).toEqual({ kind: "root" });
    expect(effects).toEqual([
      { type: "send_command", command: { type: "switch_model", agentId: "root", model: "b" } },
    ]);
  });

  test("picker: enter with no selectable option (empty model list) returns to root without a command", () => {
    let state = rootedState("");
    ({ state } = reducer(state, { type: "models_response", models: [] }));
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.view).toEqual({ kind: "root" });
    expect(effects).toEqual([]);
  });

  test("picker: escape/left cancel back to root with no command sent", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "models_response",
      models: [{ name: "a", provider: "p", model: "m", isDefault: false, isActive: true }],
    }));
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.view).toEqual({ kind: "root" });
    expect(effects).toEqual([]);
  });

  test("picker: an unrelated key is a no-op", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "models_response",
      models: [{ name: "a", provider: "p", model: "m", isDefault: false, isActive: true }],
    }));
    const before = state.view;
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "x" } }));
    expect(state.view).toEqual(before);
  });

  test("a skill-command name invokes the skill: local echo + invoke_skill effect", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "skills_response",
      skills: [{ name: "sm", description: "Sugar Maple filestore" }],
    }));
    state = { ...state, input: "/sm write a doc" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(effects).toEqual([
      {
        type: "send_command",
        command: { type: "invoke_skill", agentId: "root", skill: "sm", args: "write a doc" },
      },
    ]);
    const transcript = next.agents.get("root")?.transcript ?? [];
    expect(transcript[transcript.length - 1]).toEqual({ role: "user", text: "/sm write a doc" });
    expect(next.rootActive).toBe(true);
  });

  test("a skill command with no args echoes just the bare '/name'", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "skills_response",
      skills: [{ name: "sm", description: "Sugar Maple filestore" }],
    }));
    state = { ...state, input: "/sm" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    const transcript = next.agents.get("root")?.transcript ?? [];
    expect(transcript[transcript.length - 1]?.text).toBe("/sm");
  });

  test("an unknown command reports a local error, sending nothing", () => {
    const { state: next, effects } = reducer(rootedState("/nope"), {
      type: "key",
      key: { kind: "enter" },
    });
    expect(effects).toEqual([]);
    expect(next.statusMessage).toBe("Unknown command: /nope");
  });

  test("a built-in name shadows a same-named skill", () => {
    let state = rootedState("");
    ({ state } = reducer(state, {
      type: "skills_response",
      skills: [{ name: "help", description: "a skill that happens to be named help" }],
    }));
    state = { ...state, input: "/help" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    // Built-in /help wins: renders the local help transcript entry, no invoke_skill effect.
    expect(effects).toEqual([]);
    const transcript = next.agents.get("root")?.transcript ?? [];
    expect(transcript[transcript.length - 1]?.role).toBe("tool");
  });

  test("model_switched updates the agent's displayed model and, for root, the status message", () => {
    const state = rootedState("");
    const { state: next } = reducer(state, {
      type: "sse_event",
      event: {
        version: 1,
        id: "e10",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "model_switched",
        agentId: "root",
        from: "haiku",
        to: "sonnet",
      },
    });
    expect(next.agents.get("root")?.model).toBe("sonnet");
    expect(next.statusMessage).toBe("model switched to sonnet");
  });

  test("model_switched for a non-root agent updates its model without touching statusMessage", () => {
    let state = rootedState("");
    state = { ...state, statusMessage: "unrelated" };
    const { state: next } = reducer(state, {
      type: "sse_event",
      event: {
        version: 1,
        id: "e11",
        timestamp: "2026-07-15T00:00:00.000Z",
        type: "model_switched",
        agentId: "sub-agent",
        from: "haiku",
        to: "sonnet",
      },
    });
    expect(next.agents.get("sub-agent")?.model).toBe("sonnet");
    expect(next.statusMessage).toBe("unrelated");
  });
});

describe("DH-0142: slash-command autocomplete", () => {
  function typed(text: string): TuiState {
    return { ...initialState(size()), input: text, inputCursor: text.length };
  }

  test("Down/Up cycles the highlighted index while the dropdown is showing", () => {
    let state = typed("/");
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    expect(state.dropdownIndex).toBe(1);
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    expect(state.dropdownIndex).toBe(2);
    ({ state } = reducer(state, { type: "key", key: { kind: "up" } }));
    expect(state.dropdownIndex).toBe(1);
  });

  test("Down wraps from the last entry back to the first", () => {
    let state = typed("/");
    for (let i = 0; i < 3; i++) {
      ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    }
    // 3 built-ins, no skills cached -> wraps back to index 0 after 3 downs from 0.
    expect(state.dropdownIndex).toBe(0);
  });

  test("Enter selects the highlighted entry, inserting the full name with a trailing space", () => {
    const state = typed("/mo");
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.input).toBe("/model ");
    expect(next.inputCursor).toBe("/model ".length);
    // Selecting from the dropdown must never fall through to command dispatch/submission.
    expect(effects).toEqual([]);
  });

  test("Tab selects the highlighted entry same as Enter", () => {
    const state = typed("/cl");
    const { state: next } = reducer(state, { type: "key", key: { kind: "tab" } });
    expect(next.input).toBe("/clear ");
  });

  test("selecting after navigating Down picks the highlighted (not the first) entry", () => {
    let state = typed("/");
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } })); // -> help
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(next.input).toBe("/help ");
  });

  test("after selection, the dropdown no longer shows (query has trailing whitespace)", () => {
    const state = typed("/mo");
    const { state: next } = reducer(state, { type: "key", key: { kind: "enter" } });
    expect(visibleAutocomplete(next)).toBeNull();
  });

  test("Escape dismisses the dropdown without touching input or falling through to the default escape handling", () => {
    const state = { ...typed("/mo"), statusMessage: "kept" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(next.dropdownDismissed).toBe(true);
    expect(next.input).toBe("/mo");
    expect(next.statusMessage).toBe("kept");
  });

  test("typing a character that matches nothing closes the dropdown (no matches -> null)", () => {
    const state = typed("/zz");
    expect(visibleAutocomplete(state)).toBeNull();
  });

  test("a fresh keystroke resets dropdownDismissed back to false", () => {
    let state = typed("/mo");
    ({ state } = reducer(state, { type: "key", key: { kind: "escape" } }));
    expect(state.dropdownDismissed).toBe(true);
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "d" } }));
    expect(state.dropdownDismissed).toBe(false);
    expect(state.input).toBe("/mod");
  });

  test("paste also resets dropdown navigation/dismissal state", () => {
    let state = typed("/");
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    expect(state.dropdownIndex).toBe(1);
    ({ state } = reducer(state, { type: "key", key: { kind: "paste", text: "mo" } }));
    expect(state.dropdownIndex).toBe(0);
    expect(state.dropdownDismissed).toBe(false);
  });

  test("backspace resets dropdown navigation state", () => {
    let state = typed("/mo");
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    ({ state } = reducer(state, { type: "key", key: { kind: "backspace" } }));
    expect(state.dropdownIndex).toBe(0);
    expect(state.input).toBe("/m");
  });

  test("delete resets dropdown navigation state", () => {
    let state = { ...typed("/mo"), inputCursor: 0 };
    ({ state } = reducer(state, { type: "key", key: { kind: "down" } }));
    ({ state } = reducer(state, { type: "key", key: { kind: "delete" } }));
    expect(state.dropdownIndex).toBe(0);
    expect(state.input).toBe("mo");
  });

  test("Up/Down/Enter/Tab/Escape fall through to normal handling when the dropdown isn't showing", () => {
    const state = typed("hello");
    const { state: afterEnter } = reducer(state, { type: "key", key: { kind: "escape" } });
    expect(afterEnter.dropdownDismissed).toBe(false);
    expect(afterEnter.statusMessage).toBeNull();
  });
});
