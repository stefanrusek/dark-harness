import { describe, expect, test } from "bun:test";
import type { AgentTreeNode } from "../contracts/index.ts";
import { ELAPSED_VECTORS } from "../format.ts";
import {
  CURSOR_MARKER,
  colorizeStatus,
  formatElapsed,
  formatTokenCost,
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
    expect(colorizeStatus("running", "x")).toBe("\x1b[34mx\x1b[0m");
    expect(colorizeStatus("waiting", "x")).toBe("\x1b[33mx\x1b[0m");
    expect(colorizeStatus("done", "x")).toBe("\x1b[32mx\x1b[0m");
    expect(colorizeStatus("failed", "x")).toBe("\x1b[31mx\x1b[0m");
    expect(colorizeStatus("stopped", "x")).toBe("\x1b[35mx\x1b[0m");
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

  test("every row carries a 1-char left margin, and content never reaches the right edge (DH-0095)", () => {
    let state = baseState({ size: { rows: 8, cols: 30 } });
    state.agents.set("root", agentInfo({ transcript: [assistantTurn("x".repeat(40))] }));
    state = { ...state, rootAgentId: "root" };
    const rows = renderFrame(state);
    for (const row of rows) {
      if (row === "") continue;
      // Left margin: every non-blank row starts with the margin space, not column 0. (A
      // transcript continuation row legitimately has its own 2-space gutter indent on top
      // of this, so this only checks for at least the margin, not exactly one space.)
      expect(row.startsWith(" ")).toBe(true);
    }
    // Right margin: a run of "x" long enough to fill the full 30-col terminal width still
    // wraps before reaching the raw width — i.e. no single row's plain-text run of "x" is
    // 30 characters long (it's wrapped to `cols - 2` = 28 at most).
    const longestXRun = Math.max(
      0,
      ...rows.map((row) => (row.match(/x+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0)),
    );
    expect(longestXRun).toBeLessThan(30);
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
    const rows = renderFrame(baseState({ connection: "live" }));
    expect(rows[0]).toContain("Root Agent");
    expect(rows[0]).toContain("live");
  });

  // DH-0105: canonical connection-state colors (docs/design/style-guide.md §1/§2.3) —
  // live green, connecting/reconnecting amber (with a leading pending spinner glyph),
  // disconnected red. `EXPECTED_CONNECTION_LABEL_WORDS` below is the shared drift guard
  // against `src/web/client/format.ts`'s `CONNECTION_LABELS`.
  test("header styles the app name bold and colors the connection pill per status (DH-0065, DH-0105)", () => {
    const liveRow = renderFrame(baseState({ connection: "live" }))[0] ?? "";
    const reconnectingRow = renderFrame(baseState({ connection: "reconnecting" }))[0] ?? "";
    const disconnectedRow = renderFrame(baseState({ connection: "disconnected" }))[0] ?? "";
    expect(liveRow).toContain("\x1b[1mDark Harness\x1b[0m");
    expect(liveRow).toContain("\x1b[32mlive\x1b[0m");
    expect(reconnectingRow).toContain("\x1b[33m");
    expect(reconnectingRow).toContain("reconnecting…\x1b[0m");
    expect(disconnectedRow).toContain("\x1b[31mdisconnected\x1b[0m");
  });

  test("connecting/reconnecting connection states show a pending spinner glyph, never color alone (DH-0105)", () => {
    const connectingRow = renderFrame(baseState({ connection: "connecting" }))[0] ?? "";
    expect(connectingRow).toContain("\x1b[33m");
    expect(connectingRow).toContain("connecting…");
  });

  // Shared expected-label table (DH-0105 ticket requirement): asserted here and in
  // `src/web/client/format.test.ts` so a future edit to one surface's words without the
  // other is caught as a test failure, not silent drift. Words match modulo each surface's
  // own casing rule (DH-0100 §4: TUI/CLI lowercase, Web Title Case) and Web's trailing "…"
  // convention on pending states.
  const EXPECTED_CONNECTION_LABEL_WORDS: Record<string, string> = {
    connecting: "connecting",
    live: "live",
    reconnecting: "reconnecting",
    disconnected: "disconnected",
  };

  test("connection labels match the canonical vocabulary (docs/design/style-guide.md §1/§6)", () => {
    for (const [status, word] of Object.entries(EXPECTED_CONNECTION_LABEL_WORDS)) {
      const row = renderFrame(baseState({ connection: status as never }))[0] ?? "";
      expect(row.toLowerCase()).toContain(word);
    }
  });

  test("header shows a spinner next to the connection pill while the root agent is running (DH-0065)", () => {
    let state = baseState({ now: 0 });
    state.agents.set("root", agentInfo({ status: "running" }));
    state = { ...state, rootAgentId: "root" };
    const row = renderFrame(state)[0] ?? "";
    expect(row).toContain("working…");
  });

  test("header shows no spinner when the root agent is not running", () => {
    let state = baseState();
    state.agents.set("root", agentInfo({ status: "waiting" }));
    state = { ...state, rootAgentId: "root" };
    const row = renderFrame(state)[0] ?? "";
    expect(row).not.toContain("working…");
  });

  test("root view's default key hint is dimmed", () => {
    const rows = renderFrame(baseState());
    expect(rows.some((row) => row.includes("\x1b[2m[Enter] send"))).toBe(true);
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
    const state = baseState({
      size: { rows: 10, cols: 60 },
      view: { kind: "tree", selectedIndex: 1 },
      tree,
    });
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("a (sonnet)");
    expect(joined).toContain("b (sonnet)");
    expect(joined).toContain("navigate");
    // The selected row (index 1, "b") carries the "> " marker.
    expect(rows.some((row) => row.includes("> ") && row.includes("b (sonnet)"))).toBe(true);
  });

  // DH-0069: a sub-agent's `description` (from the Agent tool's now-required parameter) is
  // the primary label — a raw `agentId (model)` is only the fallback for entries that never
  // got one (the root agent, or a pre-DH-0069 logged session).
  test("tree view prefers an agent's description over agentId (model) when present", () => {
    const tree = [treeNode("a", { description: "Fix flaky retry test" })];
    const state = baseState({
      size: { rows: 10, cols: 60 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
    });
    const rows = renderFrame(state);
    const joined = rows.join("\n");
    expect(joined).toContain("Fix flaky retry test");
    expect(joined).not.toContain("a (sonnet)");
  });

  test("tree view nests children with indentation", () => {
    const tree = [treeNode("a", { children: [treeNode("a1")] })];
    const state = baseState({
      size: { rows: 10, cols: 60 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
    });
    const rows = renderFrame(state);
    expect(rows.some((row) => row.includes("a1 (sonnet)"))).toBe(true);
    // DH-0065: nested entries carry a tree connector, not just a plain indent.
    expect(rows.some((row) => row.includes("└─ ") && row.includes("a1 (sonnet)"))).toBe(true);
  });

  test("tree view scrolls to keep a selection below the fold visible (DH-0027)", () => {
    // 10 total rows: HEADER_ROWS(2) + footer(1) leaves 7 content rows for the tree.
    const tree = Array.from({ length: 20 }, (_, i) => treeNode(`agent-${i}`));
    // DH-0095: cols is 2 wider than the original 40 to offset the new 1-char left/right
    // frame margin (`MARGIN` in render.ts) eating into the tree view's effective wrap width
    // — otherwise this entry's ANSI-code-inflated text wraps one row earlier and "agent-19"
    // lands on a continuation row without the "> " selection marker.
    const state = baseState({
      size: { rows: 10, cols: 42 },
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
      size: { rows: 10, cols: 60 },
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
      size: { rows: 10, cols: 60 },
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
    // DH-0104: shared `formatElapsed` now adds a space between the number and unit.
    expect(joined).toContain("(1m 00s)");
    expect(joined).toContain("Last event: 12s ago");
  });

  test("tree view shows elapsed time in current status for an active agent", () => {
    const tree = [treeNode("a")];
    const state = baseState({
      size: { rows: 10, cols: 60 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
      now: 30_000,
    });
    // DH-0065: elapsed uses statusSince ("time in current status"), not lastEventAt.
    state.agents.set(
      "a",
      agentInfo({ agentId: "a", status: "running", statusSince: 5_000, lastEventAt: 20_000 }),
    );
    const rows = renderFrame(state);
    expect(rows.join("\n")).toContain("[25s]");
  });

  test("tree view omits the elapsed marker entirely for a terminal (done) agent (DH-0065)", () => {
    const tree = [treeNode("a", { status: "done" })];
    const state = baseState({
      size: { rows: 10, cols: 60 },
      view: { kind: "tree", selectedIndex: 0 },
      tree,
      now: 30_000,
    });
    state.agents.set(
      "a",
      agentInfo({ agentId: "a", status: "done", statusSince: 5_000, lastEventAt: 5_000 }),
    );
    const rows = renderFrame(state);
    const row = rows.find((r) => r.includes("a (sonnet)"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/\[\d+(s|m\d\ds|h\d\dm)\]/);
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
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ESC bytes is the point
    const joined = rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(joined).toContain("> hello there");
    expect(joined).toContain("● hi, how can I help?");
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
  test("renders a single turn as its wrapped, marker-prefixed text with no separator", () => {
    expect(renderTranscript([assistantTurn("hello")], 40)).toEqual(["\x1b[36m●\x1b[0m hello"]);
  });

  test("user turns are prefixed with the bold-yellow '>' marker", () => {
    expect(renderTranscript([{ role: "user", text: "hi" }], 40)).toEqual(["\x1b[1;33m>\x1b[0m hi"]);
  });

  test("assistant turns are prefixed with the cyan '●' marker", () => {
    expect(renderTranscript([assistantTurn("hi")], 40)).toEqual(["\x1b[36m●\x1b[0m hi"]);
  });

  test("user vs. agent markers use visibly different SGR codes", () => {
    const lines = renderTranscript([{ role: "user", text: "hi" }, assistantTurn("yo")], 40);
    expect(lines[0]).toContain("\x1b[1;33m");
    expect(lines[2]).toContain("\x1b[36m");
  });

  test("wrapped continuation rows get a blank gutter, not a repeated marker", () => {
    const lines = renderTranscript([{ role: "user", text: "a b c d e f g h" }], 5);
    expect(lines[0]?.startsWith("\x1b[1;33m>\x1b[0m ")).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("\x1b[")).toBe(false);
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  test("inserts exactly one blank separator line between consecutive turns", () => {
    const lines = renderTranscript([{ role: "user", text: "hi" }, assistantTurn("hello back")], 40);
    expect(lines).toEqual(["\x1b[1;33m>\x1b[0m hi", "", "\x1b[36m●\x1b[0m hello back"]);
  });

  test("tool turns render as a dim '⚙ ' marker, subordinate to real turns", () => {
    const lines = renderTranscript([{ role: "tool", text: 'Agent(sonnet): "Fix flaky test"' }], 40);
    expect(lines).toEqual(['\x1b[2m⚙ Agent(sonnet): "Fix flaky test"\x1b[0m']);
  });

  test("a wrapped tool turn's continuation row uses the blank gutter, not a repeated marker", () => {
    const lines = renderTranscript([{ role: "tool", text: "a b c d e f g h" }], 5);
    expect(lines[0]?.startsWith("\x1b[2m⚙ ")).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(`${"\x1b[2m"}  `)).toBe(true);
    }
  });

  test("an empty transcript renders no lines", () => {
    expect(renderTranscript([], 40)).toEqual([]);
  });
});

// DH-0104: `formatElapsed` is now the shared `src/format.ts` implementation (spaces +
// "just now" affordance) — these vectors match Web's `format.test.ts` exactly, per the
// ticket's cross-surface same-input -> same-output requirement.
describe("formatElapsed", () => {
  test("formats sub-second durations as 'just now'", () => {
    expect(formatElapsed(0)).toBe("just now");
    expect(formatElapsed(999)).toBe("just now");
  });

  test("formats sub-minute durations as seconds", () => {
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(12_000)).toBe("12s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  test("formats sub-hour durations as minutes and zero-padded seconds, space-separated", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_599_000)).toBe("59m 59s");
  });

  test("formats hour-plus durations as hours and zero-padded minutes, space-separated", () => {
    expect(formatElapsed(3_600_000)).toBe("1h 00m");
    expect(formatElapsed(7_380_000)).toBe("2h 03m");
  });

  test("clamps negative durations to 'just now'", () => {
    expect(formatElapsed(-5_000)).toBe("just now");
  });

  test("matches the shared cross-surface test vectors", () => {
    for (const [ms, expected] of ELAPSED_VECTORS) {
      expect(formatElapsed(ms)).toBe(expected);
    }
  });
});

// DH-0104: `formatTokenCost` picks token style per call site's context-class — compact for
// glanceable chrome (the tree rows and header totals, the default), full comma-form for the
// detail agent view (opted in via the "full" argument). Cost always renders via the shared
// 2-dp `formatCostUsd`, regardless of token style.
describe("formatTokenCost", () => {
  test("defaults to compact tokens (glanceable chrome: tree rows, header totals)", () => {
    expect(formatTokenCost(10_000, 2_345, 0.0456)).toBe("12.3k tok / $0.05");
  });

  test("uses full comma-form tokens when asked for the detail view", () => {
    expect(formatTokenCost(10_000, 2_345, 0.0456, "full")).toBe("12,345 tok / $0.05");
  });

  test("renders unknown cost as an em dash in both token styles", () => {
    expect(formatTokenCost(100, 50, null)).toBe("150 tok / —");
    expect(formatTokenCost(100, 50, null, "full")).toBe("150 tok / —");
  });
});
