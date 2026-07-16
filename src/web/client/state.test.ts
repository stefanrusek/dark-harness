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
} from "../../contracts/index.ts";
import {
  addUserTurn,
  agentDepth,
  applyEvent,
  createInitialState,
  dismissPossibleGap,
  documentTitle,
  isRoot,
  logError,
  markPossibleGap,
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
  description?: string,
): AgentSpawnedEvent {
  return {
    version: 1,
    id: `evt-${agentId}`,
    timestamp: new Date().toISOString(),
    type: "agent_spawned",
    agentId,
    parentAgentId,
    model,
    ...(description !== undefined ? { description } : {}),
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

function resync(): ResyncEvent {
  return {
    version: 1,
    id: "evt-resync",
    timestamp: new Date().toISOString(),
    type: "resync",
  };
}

function toolCall(agentId: string, toolUseId: string): ToolCallEvent {
  return {
    version: 1,
    id: `evt-toolcall-${toolUseId}`,
    timestamp: new Date().toISOString(),
    type: "tool_call",
    agentId,
    toolUseId,
    toolName: "Bash",
    inputSummary: "echo hi",
  };
}

function toolResult(agentId: string, toolUseId: string, isError = false): ToolResultEvent {
  return {
    version: 1,
    id: `evt-toolresult-${toolUseId}`,
    timestamp: new Date().toISOString(),
    type: "tool_result",
    agentId,
    toolUseId,
    toolName: "Bash",
    isError,
    durationMs: 12,
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

  // DH-0069: description (from the Agent tool's now-required parameter) lands on the
  // AgentNode so the render layer can use it as the sidebar/tree row's primary label.
  test("agent_spawned's description is recorded on the node when present", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null, "sonnet"));
    state = applyEvent(state, spawned("child-1", "root-1", "sonnet", "Fix flaky retry test"));
    expect(state.agents.get("child-1")?.description).toBe("Fix flaky retry test");
    expect(state.agents.get("root-1")?.description).toBeUndefined();
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

  test("agent_output accumulates chunks into one assistant turn, creating the agent if unseen", () => {
    let state = createInitialState();
    state = applyEvent(state, output("a1", "hello "));
    state = applyEvent(state, output("a1", "world"));
    const transcript = state.agents.get("a1")?.transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript?.[0]).toMatchObject({ role: "assistant", text: "hello world" });
  });

  test("agent_output after a user turn opens a new assistant turn rather than merging", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("a1", null));
    state = addUserTurn(state, "a1", "hi there", "2026-01-01T00:00:00Z");
    state = applyEvent(state, output("a1", "hello"));
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(transcript[1]?.text).toBe("hello");
  });

  test("back-to-back agent_output bursts after multiple turns each stay separate turns", () => {
    let state = createInitialState();
    state = applyEvent(state, output("a1", "first burst, "));
    state = applyEvent(state, output("a1", "still first"));
    state = addUserTurn(state, "a1", "ok continue", "2026-01-01T00:00:01Z");
    state = applyEvent(state, output("a1", "second burst"));
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript.map((t) => ({ role: t.role, text: t.text }))).toEqual([
      { role: "assistant", text: "first burst, still first" },
      { role: "user", text: "ok continue" },
      { role: "assistant", text: "second burst" },
    ]);
  });

  // DH-0066: the architect review found two consecutive assistant turns concatenating into
  // one bubble with no boundary ("Root coordinated two levels of sub-agents." shown twice,
  // glued together). That happened whenever two separate turns both had role "assistant"
  // with no user turn in between (e.g. a sub-agent that runs a second turn on its own,
  // triggered by something other than a fresh operator message) — `turnOpen` closes the
  // in-flight turn as soon as the agent leaves "running", so the next agent_output opens a
  // genuinely new turn instead of merging into stale prior text.
  test("agent_output after the agent leaves running (with no intervening user turn) opens a new turn, not a merge", () => {
    let state = createInitialState();
    state = applyEvent(state, statusEvent("a1", "running"));
    state = applyEvent(state, output("a1", "Root coordinated two levels of sub-agents."));
    state = applyEvent(state, statusEvent("a1", "done"));
    state = applyEvent(state, statusEvent("a1", "running"));
    state = applyEvent(state, output("a1", "Root coordinated two levels of sub-agents."));
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript.map((t) => ({ role: t.role, text: t.text }))).toEqual([
      { role: "assistant", text: "Root coordinated two levels of sub-agents." },
      { role: "assistant", text: "Root coordinated two levels of sub-agents." },
    ]);
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

  test("a server-detected resync event sets possibleGap, same as a client-detected gap (DH-0019)", () => {
    let state = createInitialState();
    expect(state.possibleGap).toBe(false);
    state = applyEvent(state, resync());
    expect(state.possibleGap).toBe(true);
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
    const next = setConnectionStatus(state, "live");
    expect(next.connectionStatus).toBe("live");
    expect(next.agents).toBe(state.agents);
  });
});

describe("markPossibleGap / dismissPossibleGap (DH-0024)", () => {
  // DH-0089: `tool_call`/`tool_result` are new additive SSE event types (Core's piece of
  // DH-0089). Rendering them as a live transcript marker is a separate Web round (D5,
  // assigned to Susan) — this build's handler just needs to accept them without corrupting
  // state (bumped lastEventId aside, applyEvent is otherwise a no-op for these two types).
  test("tool_call/tool_result events are accepted without altering agent state (D5 deferred to a later Web round)", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("agent-1", null));
    const before = state.agents.get("agent-1");
    state = applyEvent(state, toolCall("agent-1", "tu_1"));
    state = applyEvent(state, toolResult("agent-1", "tu_1", true));
    expect(state.agents.get("agent-1")).toEqual(before);
  });

  test("markPossibleGap sets possibleGap", () => {
    const state = createInitialState();
    expect(state.possibleGap).toBe(false);
    expect(markPossibleGap(state).possibleGap).toBe(true);
  });

  test("dismissPossibleGap clears possibleGap", () => {
    const state = markPossibleGap(createInitialState());
    expect(dismissPossibleGap(state).possibleGap).toBe(false);
  });
});

describe("logError (DH-0029)", () => {
  test("appends an entry with the given message and timestamp", () => {
    const state = createInitialState();
    const next = logError(state, "boom", "2026-01-01T00:00:00Z");
    expect(next.errorLog).toEqual([{ message: "boom", timestamp: "2026-01-01T00:00:00Z" }]);
  });

  test("defaults the timestamp to now when omitted", () => {
    const next = logError(createInitialState(), "boom");
    expect(next.errorLog[0]?.timestamp).toBeTruthy();
  });

  test("caps the log at the most recent 50 entries", () => {
    let state = createInitialState();
    for (let i = 0; i < 55; i++) {
      state = logError(state, `error-${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`);
    }
    expect(state.errorLog).toHaveLength(50);
    expect(state.errorLog[0]?.message).toBe("error-5");
    expect(state.errorLog.at(-1)?.message).toBe("error-54");
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

describe("agentDepth (DH-0066: sidebar tree indentation)", () => {
  test("root is depth 0, each generation adds one", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, spawned("child-1", "root-1"));
    state = applyEvent(state, spawned("grandchild-1", "child-1"));
    expect(agentDepth(state, "root-1")).toBe(0);
    expect(agentDepth(state, "child-1")).toBe(1);
    expect(agentDepth(state, "grandchild-1")).toBe(2);
  });

  test("an unknown agent id is depth 0", () => {
    expect(agentDepth(createInitialState(), "nope")).toBe(0);
  });

  test("a dangling parentAgentId (parent not known) stops the walk rather than throwing", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("child-1", "missing-parent"));
    expect(agentDepth(state, "child-1")).toBe(0);
  });
});

describe("documentTitle (DH-0066: informative browser tab)", () => {
  test("plain 'Dark Harness' when idle", () => {
    expect(documentTitle(createInitialState())).toBe("Dark Harness");
  });

  test("shows a running indicator while any agent is running", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = applyEvent(state, statusEvent("root-1", "running"));
    expect(documentTitle(state)).toBe("● running — Dark Harness");
  });

  test("shows a success mark once the session ends with exit code 0", () => {
    let state = createInitialState();
    state = applyEvent(state, sessionEnded(0));
    expect(documentTitle(state)).toBe("✓ session ended — Dark Harness");
  });

  test("shows a failure mark once the session ends with a nonzero exit code", () => {
    let state = createInitialState();
    state = applyEvent(state, sessionEnded(1));
    expect(documentTitle(state)).toBe("✗ session ended — Dark Harness");
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
    expect(next.agents.get("root-1")?.transcript).toEqual([
      { role: "assistant", text: "already streaming output", timestamp: expect.any(String) },
    ]);
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

describe("addUserTurn (Round 4 — local echo of the operator's own sent message)", () => {
  test("appends a user turn immediately, without needing a prior SSE event", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("root-1", null));
    state = addUserTurn(state, "root-1", "hello agent", "2026-01-01T00:00:00Z");
    const transcript = state.agents.get("root-1")?.transcript;
    expect(transcript).toEqual([
      { role: "user", text: "hello agent", timestamp: "2026-01-01T00:00:00Z" },
    ]);
  });

  test("creates the agent if unseen (defensive; app.ts only calls this for a known selected agent)", () => {
    const state = createInitialState();
    const next = addUserTurn(state, "unknown", "hi", "2026-01-01T00:00:00Z");
    expect(next.agents.get("unknown")?.transcript).toEqual([
      { role: "user", text: "hi", timestamp: "2026-01-01T00:00:00Z" },
    ]);
  });

  test("two consecutive user turns never merge, unlike assistant chunks", () => {
    let state = createInitialState();
    state = addUserTurn(state, "a1", "first", "2026-01-01T00:00:00Z");
    state = addUserTurn(state, "a1", "second", "2026-01-01T00:00:01Z");
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript.map((t) => t.text)).toEqual(["first", "second"]);
  });

  test("does not mutate the previous state object", () => {
    const state = createInitialState();
    const next = addUserTurn(state, "a1", "hi", "2026-01-01T00:00:00Z");
    expect(state.agents.size).toBe(0);
    expect(next.agents.get("a1")?.transcript).toHaveLength(1);
  });
});

describe("DH-0012: per-agent transcript cap", () => {
  test("appendAssistantChunk (via applyEvent) trims oldest turns once the transcript exceeds the cap", () => {
    let state = createInitialState();
    state = applyEvent(state, spawned("a1", null));
    // Alternate user/assistant turns (each its own distinct turn) so the trim exercises the
    // "drop whole oldest turns" path, not just "shrink the single growing turn."
    for (let i = 0; i < 5; i++) {
      state = addUserTurn(state, "a1", "x".repeat(50_000), `2026-01-01T00:00:0${i}Z`);
      state = applyEvent(state, output("a1", "y".repeat(50_000)));
    }
    const transcript = state.agents.get("a1")?.transcript ?? [];
    const total = transcript.reduce((sum, t) => sum + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(200_000);
    // Oldest turns were evicted, not merged/mangled: what remains is a suffix of what was sent.
    expect(transcript.length).toBeLessThan(10);
  });

  test("addUserTurn trims mid-turn text (not just whole-turn eviction) when a single turn is huge", () => {
    let state = createInitialState();
    state = addUserTurn(state, "a1", "a".repeat(250_000), "2026-01-01T00:00:00Z");
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.text.length).toBe(200_000);
    // The trim keeps the *end* of the oversized text (newest content), not the start.
    expect(transcript[0]?.text.endsWith("a")).toBe(true);
  });

  test("a transcript within the cap is left untouched", () => {
    let state = createInitialState();
    state = addUserTurn(state, "a1", "hello", "2026-01-01T00:00:00Z");
    const transcript = state.agents.get("a1")?.transcript ?? [];
    expect(transcript).toEqual([
      { role: "user", text: "hello", timestamp: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("DH-0012: completed-agent retention cap", () => {
  test("evicts the oldest terminal agents beyond the 50-entry retention on agent_status", () => {
    let state = createInitialState();
    // Spawn and finish 55 agents in order; only the 50 most-recently-finished should remain.
    for (let i = 0; i < 55; i++) {
      const id = `a${i}`;
      state = applyEvent(state, spawned(id, "root"));
      state = applyEvent(state, statusEvent(id, "done"));
    }
    const remaining = [...state.agents.keys()];
    expect(remaining).toHaveLength(50);
    // The oldest five (a0..a4) were evicted; the newest (a54) survives.
    expect(remaining).not.toContain("a0");
    expect(remaining).not.toContain("a4");
    expect(remaining).toContain("a54");
  });

  test("active (non-terminal) agents are never evicted regardless of count", () => {
    let state = createInitialState();
    for (let i = 0; i < 60; i++) {
      state = applyEvent(state, spawned(`a${i}`, "root"));
      state = applyEvent(state, statusEvent(`a${i}`, "running"));
    }
    expect(state.agents.size).toBe(60);
  });

  test("does not evict when at or under the retention cap", () => {
    let state = createInitialState();
    for (let i = 0; i < 3; i++) {
      state = applyEvent(state, spawned(`a${i}`, "root"));
      state = applyEvent(state, statusEvent(`a${i}`, "done"));
    }
    expect(state.agents.size).toBe(3);
  });
});
