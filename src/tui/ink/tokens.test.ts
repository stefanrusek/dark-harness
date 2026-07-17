import { describe, expect, test } from "bun:test";
import { initialState } from "../state.ts";
import {
  CURSOR_MARKER,
  bold,
  colorizeStatus,
  dim,
  formatTokenCost,
  rootAgent,
  sessionTokenTotals,
  spinnerFrame,
  viewLabel,
} from "./tokens.ts";

describe("tokens", () => {
  test("colorizeStatus wraps text in the status's SGR code", () => {
    expect(colorizeStatus("failed", "x")).toBe("\x1b[31mx\x1b[0m");
  });

  test("dim/bold wrap text in their SGR codes", () => {
    expect(dim("x")).toBe("\x1b[2mx\x1b[0m");
    expect(bold("x")).toBe("\x1b[1mx\x1b[0m");
  });

  test("CURSOR_MARKER is an inverse-video space", () => {
    expect(CURSOR_MARKER).toBe("\x1b[7m \x1b[0m");
  });

  test("spinnerFrame cycles through frames based on elapsed time", () => {
    const a = spinnerFrame(0);
    const b = spinnerFrame(100000);
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });

  test("formatTokenCost: compact vs full tiers", () => {
    expect(formatTokenCost(1000, 500, 0.01, "compact")).toContain("tok");
    expect(formatTokenCost(1000, 500, 0.01, "full")).toContain("1,500");
  });

  test("sessionTokenTotals sums across agents, cost stays null when none report one", () => {
    const state = initialState({ rows: 24, cols: 80 }, { ownsServer: false });
    expect(sessionTokenTotals(state)).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: null });
  });

  test("rootAgent is null before any root agent is known", () => {
    const state = initialState({ rows: 24, cols: 80 }, { ownsServer: false });
    expect(rootAgent(state)).toBeNull();
  });

  test("viewLabel maps every view kind to its label", () => {
    const base = initialState({ rows: 24, cols: 80 }, { ownsServer: false });
    expect(viewLabel({ ...base, view: { kind: "root" } })).toBe("Root Agent");
    expect(viewLabel({ ...base, view: { kind: "tree", selectedIndex: 0 } })).toBe("Agent Tree");
    expect(viewLabel({ ...base, view: { kind: "agent", agentId: "x" } })).toBe("Agent x");
    expect(viewLabel({ ...base, view: { kind: "picker", options: [], selectedIndex: 0 } })).toBe(
      "Select Model",
    );
  });
});
