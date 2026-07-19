import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../tasks.ts";
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

  test("default completeWithModel throws (must be overridden by tests exercising it)", async () => {
    const ctx = makeToolContext();
    await expect(
      ctx.completeWithModel("sonnet", { system: "", messages: [], tools: [] }),
    ).rejects.toThrow(/not wired/);
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

  test("overrides.tasks is used when provided, instead of a fresh TaskRegistry", () => {
    const shared = new TaskRegistry();
    shared.start({
      kind: "bash",
      parentAgentId: "agent-test-root",
      id: "task-shared",
      run: async () => {},
    });
    const ctx = makeToolContext({ tasks: shared });
    expect(ctx.tasks).toBe(shared);
    expect(ctx.tasks.list().map((t) => t.id)).toContain("task-shared");
  });
});
