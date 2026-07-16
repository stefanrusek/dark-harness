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

  // DH-0078: addressable by name (the Agent tool's `description`) alongside/instead of ids.
  test("reports status for a task addressed by name", async () => {
    const ctx = makeToolContext();
    const taskId = ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Fix flaky retry test",
      run: async () => {},
    });
    await ctx.tasks.awaitDone(taskId);
    const result = await monitorTool.execute({ names: ["Fix flaky retry test"] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain(`${taskId} [agent] status=done`);
    expect(result.output).toContain('description="Fix flaky retry test"');
  });

  test("handles a mix of task_ids and names in one call", async () => {
    const ctx = makeToolContext();
    const byId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      run: async () => {},
    });
    const byName = ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Named one",
      run: async () => {},
    });
    const result = await monitorTool.execute({ task_ids: [byId], names: ["Named one"] }, ctx);
    expect(result.output).toContain(byId);
    expect(result.output).toContain(byName);
  });

  test("reports an error line (not the whole call failing) for an unknown name", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ names: ["Ghost"] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('no sub-agent named "Ghost"');
  });

  test("reports an ambiguity error line, listing candidate task ids, for a duplicate name", async () => {
    const ctx = makeToolContext();
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Dup",
      run: async () => {},
    });
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      description: "Dup",
      run: async () => {},
    });
    const result = await monitorTool.execute({ names: ["Dup"] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("ambiguous");
    expect(result.output).toContain("agent-1");
    expect(result.output).toContain("agent-2");
  });

  test("rejects when both task_ids and names are missing/empty", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ names: [] }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a names array with non-string entries", async () => {
    const ctx = makeToolContext();
    const result = await monitorTool.execute({ names: [1] }, ctx);
    expect(result.isError).toBe(true);
  });
});
