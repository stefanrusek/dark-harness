import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";
import { todoGetTool } from "./todo-get.ts";

describe("TodoGet tool", () => {
  test("returns the full record for an existing todo", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A", description: "desc", activeForm: "Doing A" });
    const result = await todoGetTool.execute({ todo_id: "todo-1" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("id: todo-1");
    expect(result.output).toContain("status: pending");
    expect(result.output).toContain("subject: A");
    expect(result.output).toContain("description: desc");
    expect(result.output).toContain("active_form: Doing A");
  });

  test("renders (none) for absent optional fields and empty dependency sets", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    const result = await todoGetTool.execute({ todo_id: "todo-1" }, ctx);
    expect(result.output).toContain("description: (none)");
    expect(result.output).toContain("active_form: (none)");
    expect(result.output).toContain("blocked_by: (none)");
    expect(result.output).toContain("blocks: (none)");
  });

  test("renders blocked_by/blocks ids when present", async () => {
    const ctx = makeToolContext();
    ctx.todos.create({ subject: "A" });
    ctx.todos.create({ subject: "B", blockedBy: ["todo-1"] });
    const a = await todoGetTool.execute({ todo_id: "todo-1" }, ctx);
    expect(a.output).toContain("blocks: todo-2");
    const b = await todoGetTool.execute({ todo_id: "todo-2" }, ctx);
    expect(b.output).toContain("blocked_by: todo-1");
  });

  test("rejects a missing todo_id", async () => {
    const ctx = makeToolContext();
    const result = await todoGetTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("errors on an unknown todo id", async () => {
    const ctx = makeToolContext();
    const result = await todoGetTool.execute({ todo_id: "todo-999" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no such todo");
  });
});
