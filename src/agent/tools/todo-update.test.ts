import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";
import { todoUpdateTool } from "./todo-update.ts";

describe("TodoUpdate tool", () => {
  test("updates status and reports the new status", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1", status: "in_progress" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("Updated todo-1: status=in_progress");
    expect(ctx.todos.get("todo-1").status).toBe("in_progress");
  });

  test("updates subject/description/active_form", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute(
      { todo_id: "todo-1", subject: "A renamed", description: "d", active_form: "Doing A" },
      ctx,
    );
    expect(result.isError).toBe(false);
    const record = ctx.todos.get("todo-1");
    expect(record.subject).toBe("A renamed");
    expect(record.description).toBe("d");
    expect(record.activeForm).toBe("Doing A");
  });

  test("add_blocked_by / add_blocks / remove_blocked_by / remove_blocks all thread through", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    ctx.todos.create({ subject: "B" });
    ctx.todos.create({ subject: "C" });

    await todoUpdateTool.execute({ todo_id: "todo-1", add_blocked_by: ["todo-2"] }, ctx);
    expect(ctx.todos.get("todo-1").blockedBy.has("todo-2")).toBe(true);
    await todoUpdateTool.execute({ todo_id: "todo-1", remove_blocked_by: ["todo-2"] }, ctx);
    expect(ctx.todos.get("todo-1").blockedBy.has("todo-2")).toBe(false);

    await todoUpdateTool.execute({ todo_id: "todo-1", add_blocks: ["todo-3"] }, ctx);
    expect(ctx.todos.get("todo-1").blocks.has("todo-3")).toBe(true);
    await todoUpdateTool.execute({ todo_id: "todo-1", remove_blocks: ["todo-3"] }, ctx);
    expect(ctx.todos.get("todo-1").blocks.has("todo-3")).toBe(false);
  });

  test("completing a todo with open blockers succeeds and appends an advisory warning", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "Blocker" });
    ctx.todos.create({ subject: "Dependent", blockedBy: ["todo-1"] });
    const result = await todoUpdateTool.execute({ todo_id: "todo-2", status: "completed" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("status=completed");
    expect(result.output).toContain("warning:");
    expect(result.output).toContain("todo-1");
  });

  test("deleting a todo returns a confirmation message and removes it", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1", status: "deleted" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("Deleted todo-1.");
    expect(() => ctx.todos.get("todo-1")).toThrow();
  });

  test("rejects a missing todo_id", async () => {
    const ctx = makeToolContext();
    const result = await todoUpdateTool.execute({ status: "completed" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a call with no mutation fields", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("at least one field");
  });

  test("rejects an invalid status value", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1", status: "bogus" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("status");
  });

  test("rejects a non-string subject/description/active_form", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1", subject: 5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("subject");
  });

  test("rejects a non-array edge field", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute(
      { todo_id: "todo-1", add_blocked_by: "todo-2" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("add_blocked_by");
  });

  test("rejects an edge array with a non-string element", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute({ todo_id: "todo-1", add_blocked_by: [1] }, ctx);
    expect(result.isError).toBe(true);
  });

  test("errors on an unknown todo_id", async () => {
    const ctx = makeToolContext();
    const result = await todoUpdateTool.execute({ todo_id: "todo-999", status: "completed" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no such todo");
  });

  test("errors referencing an unknown id in add_blocked_by/add_blocks", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoUpdateTool.execute(
      { todo_id: "todo-1", add_blocked_by: ["todo-999"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no such todo");
  });
});
