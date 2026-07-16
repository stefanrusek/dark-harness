import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";
import { todoListTool } from "./todo-list.ts";

describe("TodoList tool", () => {
  test("reports an explicit empty state when there are no todos", async () => {
    const ctx = makeToolContext();
    const result = await todoListTool.execute({}, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("No todos yet.");
  });

  test("lists todos compactly with a count summary", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "Fix auth token refresh" });
    ctx.todos.update("todo-1", { status: "in_progress" });
    ctx.todos.create({ subject: "Write tests" });
    const result = await todoListTool.execute({}, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("todo-1 [in_progress] Fix auth token refresh");
    expect(result.output).toContain("todo-2 [pending] Write tests");
    expect(result.output).toContain("2 total");
    expect(result.output).toContain("1 in_progress");
    expect(result.output).toContain("1 pending");
  });

  test("annotates a blocked item's line with its blocked_by ids", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "Blocker" });
    ctx.todos.create({ subject: "Dependent", blockedBy: ["todo-1"] });
    const result = await todoListTool.execute({}, ctx);
    expect(result.output).toContain("todo-2 [pending] Dependent (blocked_by: todo-1)");
  });
});
