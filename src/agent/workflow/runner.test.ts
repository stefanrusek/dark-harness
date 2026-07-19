// Unit tests for the Workflow tool's injected API (DH-0226). Uses the same fake-spawnAgent
// pattern as tools/agent.test.ts (wiring ctx.spawnAgent to a real TaskRegistry-backed fake
// sub-agent "loop") so agent()/parallel() are exercised against real async task lifecycle
// semantics, not hand-rolled promises.

import { describe, expect, test } from "bun:test";
import { makeToolContext } from "../tools/test-helpers.ts";
import { buildWorkflowApi } from "./runner.ts";

function withFakeSpawn(overrides: Parameters<typeof makeToolContext>[0] = {}) {
  const ctx = makeToolContext({ ...overrides, spawnAgent: () => "placeholder" });
  ctx.spawnAgent = ({ model, prompt, description }) =>
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      model,
      ...(description !== undefined ? { description } : {}),
      run: async (handle) => {
        handle.append(`ran with prompt: ${prompt}`);
        if (prompt.includes("fail")) {
          throw new Error("sub-agent self-reported failure");
        }
      },
    });
  return ctx;
}

describe("WorkflowApi.agent()", () => {
  test("spawns exactly one sub-agent via ctx.spawnAgent and resolves to its output", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const output = await api.agent("do the thing");
    expect(output).toContain("ran with prompt: do the thing");
  });

  test("uses opts.model when given, else ctx.config.options.defaultModel", async () => {
    const ctx = withFakeSpawn();
    let capturedModel: string | undefined;
    const originalSpawn = ctx.spawnAgent;
    ctx.spawnAgent = (params) => {
      capturedModel = params.model;
      return originalSpawn(params);
    };
    const { api } = buildWorkflowApi(ctx);
    await api.agent("hi");
    expect(capturedModel).toBe("sonnet");

    await api.agent("hi", { model: "sonnet" });
    expect(capturedModel).toBe("sonnet");
  });

  test("rejects an unknown model name with a clear error", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    await expect(api.agent("hi", { model: "ghost" })).rejects.toThrow(/unknown model "ghost"/);
  });

  test("rejects when the spawned sub-agent finishes with status failed", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    await expect(api.agent("please fail")).rejects.toThrow(/sub-agent self-reported failure/);
  });

  test("defaults description to a short label when opts.description is absent", async () => {
    const ctx = withFakeSpawn();
    let capturedDescription: string | undefined;
    const originalSpawn = ctx.spawnAgent;
    ctx.spawnAgent = (params) => {
      capturedDescription = params.description;
      return originalSpawn(params);
    };
    const { api } = buildWorkflowApi(ctx);
    await api.agent("hi");
    expect(capturedDescription).toBe("workflow agent");

    await api.agent("hi", { description: "audit invoices" });
    expect(capturedDescription).toBe("audit invoices");
  });
});

describe("WorkflowApi.parallel()", () => {
  test("starts every thunk before any is awaited (barrier fan-out), preserving order", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const started: number[] = [];
    const thunks = [1, 2, 3].map((n) => async () => {
      started.push(n);
      // Yield so a sequential (non-concurrent) implementation would show up as [1],[1,2],... at
      // the wrong times; a concurrent one records all three starts before any resolves.
      await Promise.resolve();
      return n * 10;
    });
    const result = await api.parallel(thunks);
    expect(started).toEqual([1, 2, 3]);
    expect(result).toEqual([10, 20, 30]);
  });

  test("an async rejection maps that slot to null without affecting the others", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const result = await api.parallel([
      async () => "ok-1",
      async () => {
        throw new Error("boom");
      },
      async () => "ok-3",
    ]);
    expect(result).toEqual(["ok-1", null, "ok-3"]);
  });

  test("a synchronous throw from a thunk (e.g. a fan-out budget check) maps that slot to null, not an aborted call", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const result = await api.parallel([
      async () => "ok-1",
      () => {
        // Synchronous throw, not a rejected promise — mirrors ctx.spawnAgent's DH-0013
        // fan-out-budget check, which throws before ever returning a promise.
        throw new Error("maxConcurrentAgents exceeded");
      },
      async () => "ok-3",
    ]);
    expect(result).toEqual(["ok-1", null, "ok-3"]);
  });

  test("a real spawnAgent fan-out-budget throw inside a parallel() thunk maps to null; other thunks still complete", async () => {
    const ctx = withFakeSpawn();
    let calls = 0;
    const originalSpawn = ctx.spawnAgent;
    ctx.spawnAgent = (params) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("spawnAgent: maxConcurrentAgents (1) limit exceeded");
      }
      return originalSpawn(params);
    };
    const { api } = buildWorkflowApi(ctx);
    const result = await api.parallel([
      () => api.agent("first"),
      () => api.agent("second"),
      () => api.agent("third"),
    ]);
    expect(result[0]).toContain("ran with prompt: first");
    expect(result[1]).toBeNull();
    expect(result[2]).toContain("ran with prompt: third");
  });

  test("an agent() failure inside parallel() maps to null via the same rejection path", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const result = await api.parallel([() => api.agent("ok"), () => api.agent("please fail")]);
    expect(result[0]).toContain("ran with prompt: ok");
    expect(result[1]).toBeNull();
  });

  test("parallel() itself never rejects even when every thunk fails", async () => {
    const ctx = withFakeSpawn();
    const { api } = buildWorkflowApi(ctx);
    const result = await api.parallel([
      () => {
        throw new Error("a");
      },
      async () => {
        throw new Error("b");
      },
    ]);
    expect(result).toEqual([null, null]);
  });
});

describe("WorkflowApi.log()/drainLog()", () => {
  test("collects log() lines and joins them for drainLog()", () => {
    const ctx = withFakeSpawn();
    const { api, drainLog } = buildWorkflowApi(ctx);
    api.log("first");
    api.log("second");
    expect(drainLog()).toBe("first\nsecond");
  });

  test("drainLog() is empty when log() was never called", () => {
    const ctx = withFakeSpawn();
    const { drainLog } = buildWorkflowApi(ctx);
    expect(drainLog()).toBe("");
  });
});
