import { describe, expect, test } from "bun:test";
import { taskStopTool } from "./task-stop.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("TaskStop tool", () => {
  test("aborts a running task and marks it failed", async () => {
    const ctx = makeToolContext();
    let aborted = false;
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: (handle) =>
        new Promise<void>((resolve, reject) => {
          handle.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    });
    const result = await taskStopTool.execute({ task_id: taskId }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain(`Stopped ${taskId}`);
    await ctx.tasks.awaitDone(taskId);
    expect(aborted).toBe(true);
    expect(ctx.tasks.snapshot(taskId).status).toBe("failed");
  });

  test("errors on an unknown task id", async () => {
    const ctx = makeToolContext();
    const result = await taskStopTool.execute({ task_id: "bash-999" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown task id");
  });

  test("rejects a missing task_id", async () => {
    const ctx = makeToolContext();
    const result = await taskStopTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });
});
