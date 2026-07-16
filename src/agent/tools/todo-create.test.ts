import { describe, expect, test } from "bun:test";
import { TodoStore } from "../todos.ts";
import { makeToolContext } from "./test-helpers.ts";
import { todoCreateTool } from "./todo-create.ts";

describe("TodoCreate tool", () => {
  test("creates a todo and reports its id and subject", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "Fix auth token refresh" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("Created todo-1: Fix auth token refresh");
  });

  test("accepts optional description/active_form/blocked_by", async () => {
    const ctx = makeToolContext();
    const first = await todoCreateTool.execute({ subject: "First" }, ctx);
    expect(first.output).toContain("todo-1");
    const result = await todoCreateTool.execute(
      {
        subject: "Second",
        description: "fuller context",
        active_form: "Doing second",
        blocked_by: ["todo-1"],
      },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(ctx.todos.get("todo-2").description).toBe("fuller context");
    expect(ctx.todos.get("todo-2").activeForm).toBe("Doing second");
    expect(ctx.todos.get("todo-2").blockedBy.has("todo-1")).toBe(true);
  });

  test("rejects a missing subject", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("subject");
  });

  test("rejects an empty subject", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-array blocked_by", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "A", blocked_by: "todo-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("blocked_by");
  });

  test("rejects a blocked_by array with a non-string element", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "A", blocked_by: [1] }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-string description", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "A", description: 5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("description");
  });

  test("rejects a non-string active_form", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "A", active_form: 5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("active_form");
  });

  test("errors referencing an unknown blocked_by id", async () => {
    const ctx = makeToolContext();
    const result = await todoCreateTool.execute({ subject: "A", blocked_by: ["todo-999"] }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no such todo");
  });

  test("errors once the 200-item cap is reached", async () => {
    const ctx = makeToolContext({ todos: new TodoStore() });
    for (let i = 0; i < TodoStore.MAX_ITEMS; i++) {
      ctx.todos.create({ subject: `item ${i}` });
    }
    const result = await todoCreateTool.execute({ subject: "one too many" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cap");
  });

  test("rethrows an unrelated error from the store rather than swallowing it", async () => {
    const store = new TodoStore();
    store.create = () => {
      throw new Error("unexpected");
    };
    const ctx = makeToolContext({ todos: store });
    await expect(todoCreateTool.execute({ subject: "A" }, ctx)).rejects.toThrow("unexpected");
  });
});
