import { describe, expect, test } from "bun:test";
import type { AgentTreeNode } from "../contracts/index.ts";
import {
  CURSOR_MARKER,
  colorizeStatus,
  frameToAnsi,
  renderFrame,
  tailLines,
  wrapText,
} from "./render.ts";
import { initialState } from "./state.ts";
import type { TuiState } from "./types.ts";

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

  test("root view shows a waiting placeholder before any root agent is known", () => {
    const rows = renderFrame(baseState());
    expect(rows.join("\n")).toContain("Waiting for root agent to start");
  });

  test("root view renders the root agent's output and an input line", () => {
    let state = baseState();
    state.agents.set("root", {
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
      status: "running",
      output: "hello world",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });
    state = { ...state, rootAgentId: "root", input: "typing" };
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("hello world");
    expect(rows.some((row) => row.includes("> typing"))).toBe(true);
  });

  test("root view's input line ends with a visible cursor marker", () => {
    const state = baseState({ input: "typing" });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.endsWith(`> typing${CURSOR_MARKER}`))).toBe(true);
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

  test("agent view shows a placeholder when the agent has no output yet", () => {
    const state = baseState({ view: { kind: "agent", agentId: "missing" } });
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("(no output yet)");
    expect(rows.join("\n")).toContain("Model: (unknown)");
  });

  test("agent view shows the agent's model, status, and output", () => {
    const state = baseState({ view: { kind: "agent", agentId: "child" } });
    state.agents.set("child", {
      agentId: "child",
      parentAgentId: "root",
      model: "haiku",
      status: "done",
      output: "child output",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("child output");
    expect(joined).toContain("haiku");
    expect(joined).toContain("read-only");
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
    state.agents.set("root", {
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
      status: "running",
      output: lines,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });
    state = { ...state, rootAgentId: "root" };
    const rows = renderFrame(state);
    expect(rows.join("\n")).not.toContain("line-0\n");
    expect(rows.join("\n")).toContain("line-19");
  });
});
