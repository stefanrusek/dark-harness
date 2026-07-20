import { describe, expect, test } from "bun:test";
import { SessionBudget, sessionBudgetOptionsFromConfig } from "./session-budget.ts";

describe("SessionBudget", () => {
  test("recordUsage() returns undefined and accumulates when no caps configured", () => {
    const budget = new SessionBudget({
      maxCostUsd: undefined,
      maxTotalTokens: undefined,
      maxWallClockMs: undefined,
    });
    expect(budget.recordUsage(10, 20, 0.5)).toBeUndefined();
    expect(budget.isTripped).toBe(false);
  });

  test("recordUsage() trips and reports a reason when cost cap is crossed", () => {
    const budget = new SessionBudget({
      maxCostUsd: 1,
      maxTotalTokens: undefined,
      maxWallClockMs: undefined,
    });
    expect(budget.recordUsage(10, 10, 0.5)).toBeUndefined();
    const reason = budget.recordUsage(10, 10, 0.6);
    expect(reason).toContain("maxCostUsd");
    expect(budget.isTripped).toBe(true);
  });

  test("recordUsage() trips and reports a reason when token cap is crossed, including cache tokens", () => {
    const budget = new SessionBudget({
      maxCostUsd: undefined,
      maxTotalTokens: 100,
      maxWallClockMs: undefined,
    });
    const reason = budget.recordUsage(10, 10, undefined, 40, 45);
    expect(reason).toContain("maxTotalTokens");
    expect(budget.isTripped).toBe(true);
  });

  test("recordUsage() is a no-op once tripped", () => {
    const budget = new SessionBudget({
      maxCostUsd: 1,
      maxTotalTokens: undefined,
      maxWallClockMs: undefined,
    });
    budget.recordUsage(0, 0, 2);
    expect(budget.isTripped).toBe(true);
    expect(budget.recordUsage(0, 0, 100)).toBeUndefined();
  });

  test("markTripped() sets isTripped directly (wall-clock timer path)", () => {
    const budget = new SessionBudget({
      maxCostUsd: undefined,
      maxTotalTokens: undefined,
      maxWallClockMs: 1000,
    });
    expect(budget.isTripped).toBe(false);
    budget.markTripped();
    expect(budget.isTripped).toBe(true);
  });
});

describe("sessionBudgetOptionsFromConfig", () => {
  test("reads the three max* options straight from config.options", () => {
    const options = sessionBudgetOptionsFromConfig({
      models: [],
      provider: [],
      options: { maxCostUsd: 5, maxTotalTokens: 1000, maxWallClockMs: 60000 },
      // biome-ignore lint/suspicious/noExplicitAny: minimal DhConfig stub for this unit test
    } as any);
    expect(options).toEqual({ maxCostUsd: 5, maxTotalTokens: 1000, maxWallClockMs: 60000 });
  });
});
