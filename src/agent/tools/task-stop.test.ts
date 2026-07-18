import { describe, expect, test } from "bun:test";
import { taskStopTool } from "./task-stop.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("TaskStop tool", () => {
  // Round 13 (docs/handoffs/core.md): stopping a task now yields a distinct "stopped" status,
  // not "failed" — a deliberate stop is not the same diagnostic signal as a genuine failure.
  test("aborts a running task and marks it stopped (not failed)", async () => {
    const ctx = makeToolContext();
    let aborted = false;
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: (handle) =>
        new Promise<void>((_resolve, reject) => {
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
    expect(ctx.tasks.snapshot(taskId).status).toBe("stopped");
  });

  test("stopping an already-finished task reports 'already finished', not a false 'Stopped' claim", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {},
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await taskStopTool.execute({ task_id: taskId }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("already finished");
    expect(result.output).not.toContain("Stopped");
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
