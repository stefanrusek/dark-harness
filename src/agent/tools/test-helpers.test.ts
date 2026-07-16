import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";

describe("makeToolContext defaults", () => {
  test("provides a cwd, agentId, config, and fresh task registry", () => {
    const ctx = makeToolContext();
    expect(ctx.cwd).toBe(process.cwd());
    expect(ctx.agentId).toBe("agent-test-root");
    expect(ctx.config.options.defaultModel).toBe("sonnet");
    expect(ctx.tasks.list()).toEqual([]);
  });

  test("default spawnAgent throws (must be overridden by tests exercising Agent tool)", () => {
    const ctx = makeToolContext();
    expect(() => ctx.spawnAgent({ model: "sonnet", prompt: "hi" })).toThrow(/not wired/);
  });

  test("default loadSkill resolves null", async () => {
    const ctx = makeToolContext();
    await expect(ctx.loadSkill("whatever")).resolves.toBeNull();
  });

  test("default searchDeferredTools returns no results", async () => {
    const ctx = makeToolContext();
    await expect(ctx.searchDeferredTools("whatever")).resolves.toEqual({ results: [] });
  });

  test("default activatedTools is a fresh empty Set", () => {
    const ctx = makeToolContext();
    expect(ctx.activatedTools.size).toBe(0);
  });

  test("overrides replace defaults", () => {
    const ctx = makeToolContext({ cwd: "/tmp", agentId: "custom" });
    expect(ctx.cwd).toBe("/tmp");
    expect(ctx.agentId).toBe("custom");
  });
});
