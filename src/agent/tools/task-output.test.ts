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

  describe("Round 13: incremental delta", () => {
    test("a second call after more output only returns the delta, not the full history again", async () => {
      const ctx = makeToolContext();
      let emitMore: (() => void) | undefined;
      const moreReady = new Promise<void>((resolve) => {
        emitMore = resolve;
      });
      const taskId = ctx.tasks.start({
        kind: "bash",
        parentAgentId: ctx.agentId,
        run: async (handle) => {
          handle.append("first chunk");
          await moreReady;
          handle.append("second chunk");
        },
      });

      const first = await taskOutputTool.execute({ task_id: taskId }, ctx);
      expect(first.output).toContain("first chunk");
      expect(first.output).not.toContain("second chunk");

      emitMore?.();
      await ctx.tasks.awaitDone(taskId);

      const second = await taskOutputTool.execute({ task_id: taskId }, ctx);
      expect(second.output).toContain("second chunk");
      expect(second.output).not.toContain("first chunk");
    });

    test("full: true returns the entire accumulated output regardless of prior calls", async () => {
      const ctx = makeToolContext();
      const taskId = ctx.tasks.start({
        kind: "bash",
        parentAgentId: ctx.agentId,
        run: async (handle) => {
          handle.append("alpha ");
          handle.append("beta");
        },
      });
      await ctx.tasks.awaitDone(taskId);

      await taskOutputTool.execute({ task_id: taskId }, ctx);
      const result = await taskOutputTool.execute({ task_id: taskId, full: true }, ctx);
      expect(result.output).toContain("alpha beta");
    });

    test("a poll with no new output since the last check says so explicitly", async () => {
      const ctx = makeToolContext();
      const taskId = ctx.tasks.start({
        kind: "bash",
        parentAgentId: ctx.agentId,
        run: async (handle) => {
          handle.append("only chunk");
        },
      });
      await ctx.tasks.awaitDone(taskId);

      await taskOutputTool.execute({ task_id: taskId }, ctx);
      const second = await taskOutputTool.execute({ task_id: taskId }, ctx);
      expect(second.output).toContain("no new output since your last check");
    });
  });
});
