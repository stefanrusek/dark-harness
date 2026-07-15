import { describe, expect, test } from "bun:test";
import { sendMessageTool } from "./send-message.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("SendMessage tool", () => {
  test("delivers a message to a task that registered a sink", async () => {
    const ctx = makeToolContext();
    const received: string[] = [];
    let resolveReady: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      run: async (handle) => {
        handle.registerSendMessage((message) => received.push(message));
        resolveReady();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    await ready;
    const result = await sendMessageTool.execute({ task_id: "agent-1", message: "hi there" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("delivered");
    expect(received).toEqual(["hi there"]);
  });

  test("errors on an unknown task id", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ task_id: "agent-999", message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown task id");
  });

  test("errors when the task hasn't registered a message sink (e.g. a bash task)", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {},
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await sendMessageTool.execute({ task_id: taskId, message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("delivery failed:");
  });

  test("rejects a missing task_id", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ message: "hi" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a missing message", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ task_id: "agent-1" }, ctx);
    expect(result.isError).toBe(true);
  });
});
