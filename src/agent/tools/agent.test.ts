import { describe, expect, test } from "bun:test";
import { agentTool } from "./agent.ts";
import { makeToolContext } from "./test-helpers.ts";

/** Wires ctx.spawnAgent to a fake sub-agent "loop" registered in the same TaskRegistry, the
 * way runtime.ts wires it for real against the actual agent loop. */
function withFakeSpawn(overrides: Parameters<typeof makeToolContext>[0] = {}) {
  const ctx = makeToolContext({
    ...overrides,
    spawnAgent: () => "placeholder",
  });
  ctx.spawnAgent = ({ model, prompt }) =>
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      model,
      run: async (handle) => {
        handle.append(`ran with prompt: ${prompt}`);
        if (prompt.includes("fail")) {
          throw new Error("sub-agent self-reported failure");
        }
      },
    });
  return ctx;
}

describe("Agent tool", () => {
  test("spawns a background sub-agent and returns a task id immediately", async () => {
    const ctx = withFakeSpawn({ runInBackgroundDefault: true });
    const result = await agentTool.execute({ prompt: "do the thing" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toMatch(/Spawned sub-agent as task agent-\d+/);
  });

  test("run_in_background: false blocks and returns the sub-agent's output", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute(
      { prompt: "do the thing", run_in_background: false },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("ran with prompt: do the thing");
  });

  test("run_in_background: false surfaces sub-agent failure", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute(
      { prompt: "please fail", run_in_background: false },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("sub-agent self-reported failure");
  });

  test("defaults to options.defaultModel when no model is given", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute({ prompt: "hi", run_in_background: true }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("model: sonnet");
  });

  test("accepts an explicit known model name", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute(
      { prompt: "hi", model: "sonnet", run_in_background: true },
      ctx,
    );
    expect(result.output).toContain("model: sonnet");
  });

  test("rejects an unknown model name", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute({ prompt: "hi", model: "ghost" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown model");
  });

  test("rejects a non-string model", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute({ prompt: "hi", model: 5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'model'");
  });

  test("rejects a missing prompt", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects an empty prompt", async () => {
    const ctx = withFakeSpawn();
    const result = await agentTool.execute({ prompt: "" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("runInBackgroundDefault false runs in the foreground without an explicit flag", async () => {
    const ctx = withFakeSpawn({ runInBackgroundDefault: false });
    const result = await agentTool.execute({ prompt: "hi" }, ctx);
    expect(result.output).toContain("ran with prompt: hi");
  });
});
