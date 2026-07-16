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

  test("errors when the task hasn't registered a message sink (e.g. a still-running bash task)", async () => {
    const ctx = makeToolContext();
    let release: () => void = () => {};
    const stillRunning = new Promise<void>((resolve) => {
      release = resolve;
    });
    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {
        await stillRunning;
      },
    });
    const result = await sendMessageTool.execute({ task_id: taskId, message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("delivery failed:");
    release();
    await ctx.tasks.awaitDone(taskId);
  });

  // Round 13 (docs/handoffs/core.md, P1 item 4): previously this silently "succeeded" while
  // the message landed in a pendingMessages array nobody would ever read again.
  test("refuses to deliver to a finished task instead of falsely reporting success", async () => {
    const ctx = makeToolContext();
    let sawSink = false;
    const taskId = ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      run: async (handle) => {
        handle.registerSendMessage(() => {
          sawSink = true;
        });
      },
    });
    await ctx.tasks.awaitDone(taskId);
    expect(ctx.tasks.snapshot(taskId).status).toBe("done");

    const result = await sendMessageTool.execute({ task_id: taskId, message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("already finished");
    expect(result.output).not.toContain("Message delivered");
    expect(sawSink).toBe(false);
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

  // DH-0078: addressable by name (the Agent tool's `description`), not just task_id.
  test("delivers a message to a task addressed by its name", async () => {
    const ctx = makeToolContext();
    const received: string[] = [];
    let resolveReady: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const taskId = ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Fix flaky retry test",
      run: async (handle) => {
        handle.registerSendMessage((message) => received.push(message));
        resolveReady();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    await ready;
    const result = await sendMessageTool.execute(
      { name: "Fix flaky retry test", message: "hi there" },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain(taskId);
    expect(received).toEqual(["hi there"]);
  });

  test("errors when no task with the given name is found", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ name: "Ghost task", message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('no sub-agent named "Ghost task"');
  });

  test("errors on an ambiguous name, listing every matching task id", async () => {
    const ctx = makeToolContext();
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Refactor auth",
      run: async () => {},
    });
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Refactor auth",
      run: async () => {},
    });
    const result = await sendMessageTool.execute({ name: "Refactor auth", message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("ambiguous");
    expect(result.output).toContain("agent-1");
    expect(result.output).toContain("agent-2");
  });

  test("name lookup is scoped to the calling agent's own tasks, not a global namespace", async () => {
    const ctx = makeToolContext();
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: "some-other-agent",
      description: "Not mine",
      run: async () => {},
    });
    const result = await sendMessageTool.execute({ name: "Not mine", message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('no sub-agent named "Not mine"');
  });

  test("rejects providing both task_id and name", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute(
      { task_id: "agent-1", name: "whatever", message: "hi" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("either 'task_id' or 'name', not both");
  });

  test("rejects a non-string name", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ name: 5, message: "hi" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects an empty task_id", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ task_id: "", message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'task_id' must be a non-empty string");
  });

  test("rejects when neither task_id nor name is provided", async () => {
    const ctx = makeToolContext();
    const result = await sendMessageTool.execute({ message: "hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("either 'task_id' or 'name' is required");
  });
});
