import { describe, expect, test } from "bun:test";
import type { AgentTreeNode } from "../contracts/index.ts";
import {
  CURSOR_MARKER,
  colorizeStatus,
  formatElapsed,
  frameToAnsi,
  renderFrame,
  renderTranscript,
  tailLines,
  wrapText,
} from "./render.ts";
import { initialState } from "./state.ts";
import type { AgentInfo, TuiState, Turn } from "./types.ts";

function treeNode(agentId: string, overrides: Partial<AgentTreeNode> = {}): AgentTreeNode {
  return {
    agentId,
    parentAgentId: null,
    model: "sonnet",
    status: "running",
    children: [],
    ...overrides,
  };
}

function agentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agentId: "root",
    parentAgentId: null,
    model: "sonnet",
    status: "running",
    transcript: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    lastEventAt: 0,
    statusSince: 0,
    ...overrides,
  };
}

function assistantTurn(text: string): Turn {
  return { role: "assistant", text };
}

describe("wrapText", () => {
  test("splits a long line at the given width", () => {
    expect(wrapText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });

  test("preserves existing newlines as separate logical lines", () => {
    expect(wrapText("ab\ncd", 10)).toEqual(["ab", "cd"]);
  });

  test("an empty source line yields an empty output line", () => {
    expect(wrapText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });

  test("treats a non-positive width as 1 to avoid an infinite loop", () => {
    expect(wrapText("ab", 0)).toEqual(["a", "b"]);
  });
});

describe("tailLines", () => {
  test("returns all lines when under the limit", () => {
    expect(tailLines(["a", "b"], 5)).toEqual(["a", "b"]);
  });

  test("keeps only the last N lines when over the limit", () => {
    expect(tailLines(["a", "b", "c"], 2)).toEqual(["b", "c"]);
  });

  test("clamps a negative max to 0", () => {
    expect(tailLines(["a", "b"], -1)).toEqual([]);
  });
});

describe("colorizeStatus", () => {
  test("wraps text in the color for each status", () => {
    expect(colorizeStatus("running", "x")).toBe("\x1b[33mx\x1b[0m");
    expect(colorizeStatus("waiting", "x")).toBe("\x1b[36mx\x1b[0m");
    expect(colorizeStatus("done", "x")).toBe("\x1b[32mx\x1b[0m");
    expect(colorizeStatus("failed", "x")).toBe("\x1b[31mx\x1b[0m");
    expect(colorizeStatus("stopped", "x")).toBe("\x1b[90mx\x1b[0m");
  });
});

describe("frameToAnsi", () => {
  test("prefixes cursor-home, clears each line, and clears to end of screen", () => {
    const result = frameToAnsi(["a", "b"]);
    expect(result).toBe("\x1b[Ha\x1b[K\nb\x1b[K\x1b[J");
  });

  test("handles an empty frame", () => {
    expect(frameToAnsi([])).toBe("\x1b[H\x1b[J");
  });
});

describe("renderFrame", () => {
  function baseState(overrides: Partial<TuiState> = {}): TuiState {
    return { ...initialState({ rows: 10, cols: 40 }), ...overrides };
  }

  test("always returns exactly `rows` lines", () => {
    const rows = renderFrame(baseState({ size: { rows: 15, cols: 30 } }));
    expect(rows).toHaveLength(15);
  });

  test("header shows the reconnect notice when set, regardless of the current view (DH-0024)", () => {
    const state = baseState({
      reconnectNotice: "Reconnected — history may be incomplete.",
      view: { kind: "tree", selectedIndex: 0 },
      tree: [],
    });
    const rows = renderFrame(state);
    expect(rows[0]).toContain("Reconnected — history may be incomplete.");
  });

  test("header omits the reconnect notice when unset", () => {
    const rows = renderFrame(baseState());
    expect(rows[0]).not.toContain("Reconnected");
  });

  test("root view shows a waiting placeholder before any root agent is known", () => {
    const rows = renderFrame(baseState());
    expect(rows.join("\n")).toContain("Waiting for root agent to start");
  });

  test("root view renders the root agent's output and an input line", () => {
    let state = baseState();
    state.agents.set("root", agentInfo({ transcript: [assistantTurn("hello world")] }));
    state = { ...state, rootAgentId: "root", input: "typing", inputCursor: 6 };
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("hello world");
    expect(rows.some((row) => row.includes("> typing"))).toBe(true);
  });

  test("root view's input line ends with a visible cursor marker when the cursor is at the end", () => {
    const state = baseState({ input: "typing", inputCursor: 6 });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.endsWith(`> typing${CURSOR_MARKER}`))).toBe(true);
  });

  test("root view's input line renders the cursor marker mid-string when the cursor is not at the end", () => {
    const state = baseState({ input: "typing", inputCursor: 2 });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.endsWith(`> ty${CURSOR_MARKER}ping`))).toBe(true);
  });

  test("an embedded newline from a paste renders as a visible glyph on the one-line input display", () => {
    const state = baseState({ input: "a\nb", inputCursor: 3 });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.endsWith(`> a⏎b${CURSOR_MARKER}`))).toBe(true);
  });

  test("root view shows the cursor marker even with empty input", () => {
    const state = baseState({ input: "" });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.endsWith(`> ${CURSOR_MARKER}`))).toBe(true);
  });

  test("tree and agent views do not render the cursor marker (read-only)", () => {
    const treeState = baseState({ view: { kind: "tree", selectedIndex: 0 }, tree: [] });
    const agentState = baseState({ view: { kind: "agent", agentId: "missing" } });
    expect(renderFrame(treeState).some((row) => row.includes(CURSOR_MARKER))).toBe(false);
    expect(renderFrame(agentState).some((row) => row.includes(CURSOR_MARKER))).toBe(false);
  });

  test("root view shows a status message instead of the default hint when set", () => {
    const state = baseState({ statusMessage: "No root agent yet — please wait." });
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("No root agent yet");
  });

  test("root view header reflects connection status and view label", () => {
    const rows = renderFrame(baseState({ connection: "open" }));
    expect(rows[0]).toContain("Root Agent");
    expect(rows[0]).toContain("open");
  });

  test("header shows session-ended info once the session has ended", () => {
    const rows = renderFrame(baseState({ sessionEnded: { exitCode: 1 } }));
    expect(rows[0]).toContain("session ended (exit 1)");
  });

  test("tree view shows a placeholder when there are no agents", () => {
    const state = baseState({ view: { kind: "tree", selectedIndex: 0 }, tree: [] });
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("No agents yet.");
  });

  test("tree view lists agents with a selection marker and hint", () => {
    const tree = [treeNode("a"), treeNode("b", { status: "failed" })];
    const state = baseState({ view: { kind: "tree", selectedIndex: 1 }, tree });
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("a (sonnet)");
    expect(joined).toContain("b (sonnet)");
    expect(joined).toContain("navigate");
    // The selected row (index 1, "b") carries the "> " marker.
    expect(rows.some((row) => row.includes("> ") && row.includes("b (sonnet)"))).toBe(true);
  });

  test("tree view nests children with indentation", () => {
    const tree = [treeNode("a", { children: [treeNode("a1")] })];
    const state = baseState({ view: { kind: "tree", selectedIndex: 0 }, tree });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.includes("a1 (sonnet)"))).toBe(true);
  });

  test("tree view scrolls to keep a selection below the fold visible (DH-0027)", () => {
    // 10 total rows: HEADER_ROWS(2) + footer(1) leaves 7 content rows for the tree.
    const tree = Array.from({ length: 20 }, (_, i) => treeNode(`agent-${i}`));
    const state = baseState({
      size: { rows: 10, cols: 40 },
      view: { kind: "tree", selectedIndex: 19 },
      tree,
    });
    const rows = renderFrame(state);
    // The old bottom-anchored `tailLines` behavior would have also shown the last entry, so
    // assert the marker is actually visible, not just present somewhere by coincidence.
    expect(rows.some((row) => row.includes("> ") && row.includes("agent-19"))).toBe(true);
  });

  test("tree view scrolls up to follow a selection moved back above the fold (DH-0027)", () => {
    const tree = Array.from({ length: 20 }, (_, i) => treeNode(`agent-${i}`));
    const state = baseState({
      size: { rows: 10, cols: 40 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
    });
    const rows = renderFrame(state);
    // A pure bottom-anchored view (the pre-fix behavior) would never show entry 0 once the
    // tree is taller than the viewport — this is exactly the bug DH-0027 reports.
    expect(rows.some((row) => row.includes("> ") && row.includes("agent-0 "))).toBe(true);
  });

  test("tree view shows the full tree without scrolling when it fits the viewport", () => {
    const tree = [treeNode("a"), treeNode("b")];
    const state = baseState({
      size: { rows: 10, cols: 40 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
    });
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("a (sonnet)");
    expect(joined).toContain("b (sonnet)");
  });

  test("agent view shows a placeholder when the agent has no output yet", () => {
    const state = baseState({ view: { kind: "agent", agentId: "missing" } });
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("(no output yet)");
    expect(rows.join("\n")).toContain("Model: (unknown)");
  });

  test("agent view shows the agent's model, status, and output", () => {
    const state = baseState({ view: { kind: "agent", agentId: "child" } });
    state.agents.set(
      "child",
      agentInfo({
        agentId: "child",
        parentAgentId: "root",
        model: "haiku",
        status: "done",
        transcript: [assistantTurn("child output")],
      }),
    );
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("child output");
    expect(joined).toContain("haiku");
    expect(joined).toContain("read-only");
  });

  test("agent view shows elapsed time in status and since last event", () => {
    const state = baseState({
      view: { kind: "agent", agentId: "child" },
      now: 125_000,
    });
    state.agents.set(
      "child",
      agentInfo({
        agentId: "child",
        status: "running",
        statusSince: 65_000, // 60s elapsed
        lastEventAt: 113_000, // 12s elapsed
      }),
    );
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("(1m00s)");
    expect(joined).toContain("Last event: 12s ago");
  });

  test("tree view shows elapsed time since last event per agent", () => {
    const tree = [treeNode("a")];
    const state = baseState({
      view: { kind: "tree", selectedIndex: 0 },
      tree,
      now: 30_000,
    });
    state.agents.set("a", agentInfo({ agentId: "a", lastEventAt: 5_000 }));
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("[25s]");
  });

  test("tree view omits the elapsed marker for an agent not yet known client-side", () => {
    const tree = [treeNode("unknown-agent")];
    const state = baseState({ view: { kind: "tree", selectedIndex: 0 }, tree });
    const rows = renderFrame(state);
    const row = rows.find((r) => r.includes("unknown-agent"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/\[\d+(s|m\d\ds|h\d\dm)\]/);
  });

  test("agent view shows a status message instead of the default footer when set", () => {
    const state = baseState({
      view: { kind: "agent", agentId: "child" },
      statusMessage: "custom message",
    });
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("custom message");
  });

  test("output longer than the content area shows only the tail", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    let state = baseState({ size: { rows: 8, cols: 40 } });
    state.agents.set("root", agentInfo({ transcript: [assistantTurn(lines)] }));
    state = { ...state, rootAgentId: "root" };
    const rows = renderFrame(state);
    expect(rows.join("\n")).not.toContain("line-0\n");
    expect(rows.join("\n")).toContain("line-19");
  });

  test("root view shows the operator's own sent message as a distinct user turn", () => {
    let state = baseState();
    state.agents.set("root", {
      ...agentInfo(),
      transcript: [{ role: "user", text: "hello there" }, assistantTurn("hi, how can I help?")],
    });
    state = { ...state, rootAgentId: "root" };
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("> hello there");
    expect(joined).toContain("hi, how can I help?");
  });

  test("multiple back-to-back assistant turns render as visually separate turns", () => {
    let state = baseState();
    state.agents.set("root", {
      ...agentInfo(),
      transcript: [assistantTurn("first turn"), assistantTurn("second turn")],
    });
    state = { ...state, rootAgentId: "root" };
    const rows = renderFrame(state);
    const firstIndex = rows.findIndex((row) => row.includes("first turn"));
    const secondIndex = rows.findIndex((row) => row.includes("second turn"));
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    // A blank separator row sits strictly between the two turns.
    expect(rows.slice(firstIndex + 1, secondIndex).some((row) => row === "")).toBe(true);
  });
});

describe("renderTranscript", () => {
  test("renders a single turn as its wrapped text with no separator", () => {
    expect(renderTranscript([assistantTurn("hello")], 40)).toEqual(["hello"]);
  });

  test("user turns are prefixed with the input-prompt marker", () => {
    expect(renderTranscript([{ role: "user", text: "hi" }], 40)).toEqual(["> hi"]);
  });

  test("assistant turns are not prefixed", () => {
    expect(renderTranscript([assistantTurn("hi")], 40)).toEqual(["hi"]);
  });

  test("inserts exactly one blank separator line between consecutive turns", () => {
    const lines = renderTranscript([{ role: "user", text: "hi" }, assistantTurn("hello back")], 40);
    expect(lines).toEqual(["> hi", "", "hello back"]);
  });

  test("an empty transcript renders no lines", () => {
    expect(renderTranscript([], 40)).toEqual([]);
  });
});

describe("formatElapsed", () => {
  test("formats sub-minute durations as seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(12_000)).toBe("12s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  test("formats sub-hour durations as minutes and zero-padded seconds", () => {
    expect(formatElapsed(60_000)).toBe("1m00s");
    expect(formatElapsed(65_000)).toBe("1m05s");
    expect(formatElapsed(3_599_000)).toBe("59m59s");
  });

  test("formats hour-plus durations as hours and zero-padded minutes", () => {
    expect(formatElapsed(3_600_000)).toBe("1h00m");
    expect(formatElapsed(7_380_000)).toBe("2h03m");
  });

  test("clamps negative durations to 0s", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});
