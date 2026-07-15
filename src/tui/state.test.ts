import { describe, expect, test } from "bun:test";
import type {
  AgentOutputEvent,
  AgentSpawnedEvent,
  AgentStatusEvent,
  AgentTreeNode,
  SessionEndedEvent,
  TokenUsageEvent,
} from "../contracts/index.ts";
import { MAX_OUTPUT_CHARS, initialState, reducer } from "./state.ts";
import type { TuiState } from "./types.ts";

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
    const { state } = reducer(initialState(size()), { type: "connection", status: "open" });
    expect(state.connection).toBe("open");
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

  test("left-arrow with non-empty input is a no-op", () => {
    let state = initialState(size());
    state = { ...state, input: "hi" };
    const { state: next, effects } = reducer(state, { type: "key", key: { kind: "left" } });
    expect(next.view).toEqual({ kind: "root" });
    expect(effects).toEqual([]);
  });

  test("typing characters appends to input", () => {
    let state = initialState(size());
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "h" } }));
    ({ state } = reducer(state, { type: "key", key: { kind: "char", value: "i" } }));
    expect(state.input).toBe("hi");
  });

  test("backspace removes the last character", () => {
    let state = initialState(size());
    state = { ...state, input: "hi" };
    const { state: next } = reducer(state, { type: "key", key: { kind: "backspace" } });
    expect(next.input).toBe("h");
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
