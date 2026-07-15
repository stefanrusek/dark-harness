import { describe, expect, test } from "bun:test";
import { monitorTool } from "./monitor.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("Monitor tool", () => {
  test("reports status for known task ids", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async (handle) => {
        handle.append("done");
      },
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await monitorTool.execute({ task_ids: [taskId] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain(`${taskId} [bash] status=done`);
  });

  test("includes the model for agent-kind tasks", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      model: "sonnet",
      run: async () => {},
    });
    const result = await monitorTool.execute({ task_ids: [taskId] }, ctx);
    expect(result.output).toContain("model=sonnet");
  });

  test("reports 'not found' for unknown ids without failing the whole call", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ task_ids: ["bash-999"] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("bash-999: not found");
  });

  test("handles a mix of known and unknown ids", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {},
    });
    const result = await monitorTool.execute({ task_ids: [taskId, "bash-999"] }, ctx);
    expect(result.output.split("\n")).toHaveLength(2);
  });

  test("rejects a missing task_ids", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects an empty task_ids array", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ task_ids: [] }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a task_ids array with non-string entries", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ task_ids: [1] }, ctx);
    expect(result.isError).toBe(true);
  });
});
