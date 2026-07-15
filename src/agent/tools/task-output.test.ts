import { describe, expect, test } from "bun:test";
import { taskOutputTool } from "./task-output.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("TaskOutput tool", () => {
  test("returns accumulated output and status for a completed task", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async (handle) => {
        handle.append("hello ");
        handle.append("world");
      },
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await taskOutputTool.execute({ task_id: taskId }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("status=done");
    expect(result.output).toContain("hello world");
  });

  test("includes the error message for a failed task", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {
        throw new Error("boom");
      },
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await taskOutputTool.execute({ task_id: taskId }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("error=boom");
  });

  test("errors on an unknown task id", async () => {
    const ctx = makeToolContext();
    const result = await taskOutputTool.execute({ task_id: "bash-999" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown task id");
  });

  test("rejects a missing task_id", async () => {
    const ctx = makeToolContext();
    const result = await taskOutputTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });
});
