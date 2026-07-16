import { describe, expect, test } from "bun:test";
import { TodoCapExceededError, TodoNotFoundError, TodoStore } from "./todos.ts";

describe("TodoStore", () => {
  test("create assigns sequential todo-N ids and defaults to pending", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "First" });
    const b = store.create({ subject: "Second" });
    expect(a.id).toBe("todo-1");
    expect(b.id).toBe("todo-2");
    expect(a.status).toBe("pending");
  });

  test("create accepts optional description/active_form/blocked_by and populates the inverse blocks edge", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    const b = store.create({
      subject: "B",
      description: "fuller context",
      activeForm: "Doing B",
      blockedBy: [a.id],
    });
    expect(b.description).toBe("fuller context");
    expect(b.activeForm).toBe("Doing B");
    expect(b.blockedBy.has(a.id)).toBe(true);
    expect(store.get(a.id).blocks.has(b.id)).toBe(true);
  });

  test("create rejects an unknown blocked_by id", () => {
    const store = new TodoStore();
    expect(() => store.create({ subject: "A", blockedBy: ["todo-999"] })).toThrow(
      TodoNotFoundError,
    );
  });

  test("create enforces the 200-item cap", () => {
    const store = new TodoStore();
    for (let i = 0; i < TodoStore.MAX_ITEMS; i++) {
      store.create({ subject: `item ${i}` });
    }
    expect(() => store.create({ subject: "one too many" })).toThrow(TodoCapExceededError);
  });

  test("get returns the full record; throws for an unknown id", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    expect(store.get(a.id).subject).toBe("A");
    expect(() => store.get("todo-999")).toThrow(TodoNotFoundError);
  });

  test("list returns todos in creation order", () => {
    const store = new TodoStore();
    store.create({ subject: "A" });
    store.create({ subject: "B" });
    expect(store.list().map((t) => t.subject)).toEqual(["A", "B"]);
  });

  test("list on an empty store returns an empty array", () => {
    const store = new TodoStore();
    expect(store.list()).toEqual([]);
  });

  test("update edits subject/description/active_form/status", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    const result = store.update(a.id, {
      subject: "A renamed",
      description: "new description",
      activeForm: "Doing A",
      status: "in_progress",
    });
    expect(result.record?.subject).toBe("A renamed");
    expect(result.record?.description).toBe("new description");
    expect(result.record?.activeForm).toBe("Doing A");
    expect(result.record?.status).toBe("in_progress");
    expect(result.warning).toBeUndefined();
  });

  test("status may move freely in any direction, including completed back to in_progress", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    store.update(a.id, { status: "completed" });
    const result = store.update(a.id, { status: "in_progress" });
    expect(result.record?.status).toBe("in_progress");
  });

  test("completing a todo with open blockers succeeds but returns an advisory warning", () => {
    const store = new TodoStore();
    const blocker = store.create({ subject: "Blocker" });
    const dependent = store.create({ subject: "Dependent", blockedBy: [blocker.id] });
    const result = store.update(dependent.id, { status: "completed" });
    expect(result.record?.status).toBe("completed");
    expect(result.warning).toContain(blocker.id);
  });

  test("completing a todo whose blockers are already completed has no warning", () => {
    const store = new TodoStore();
    const blocker = store.create({ subject: "Blocker" });
    const dependent = store.create({ subject: "Dependent", blockedBy: [blocker.id] });
    store.update(blocker.id, { status: "completed" });
    const result = store.update(dependent.id, { status: "completed" });
    expect(result.warning).toBeUndefined();
  });

  test("add_blocked_by / add_blocks maintain both sides of the edge", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    const b = store.create({ subject: "B" });
    store.update(a.id, { addBlockedBy: [b.id] });
    expect(store.get(a.id).blockedBy.has(b.id)).toBe(true);
    expect(store.get(b.id).blocks.has(a.id)).toBe(true);

    const c = store.create({ subject: "C" });
    store.update(a.id, { addBlocks: [c.id] });
    expect(store.get(a.id).blocks.has(c.id)).toBe(true);
    expect(store.get(c.id).blockedBy.has(a.id)).toBe(true);
  });

  test("remove_blocked_by / remove_blocks maintain both sides of the edge", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    const b = store.create({ subject: "B", blockedBy: [] });
    store.update(a.id, { addBlockedBy: [b.id] });
    store.update(a.id, { removeBlockedBy: [b.id] });
    expect(store.get(a.id).blockedBy.has(b.id)).toBe(false);
    expect(store.get(b.id).blocks.has(a.id)).toBe(false);

    store.update(a.id, { addBlocks: [b.id] });
    store.update(a.id, { removeBlocks: [b.id] });
    expect(store.get(a.id).blocks.has(b.id)).toBe(false);
    expect(store.get(b.id).blockedBy.has(a.id)).toBe(false);
  });

  test("update rejects an unknown add_blocked_by/add_blocks id without applying other edges", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    expect(() => store.update(a.id, { addBlockedBy: ["todo-999"] })).toThrow(TodoNotFoundError);
    expect(() => store.update(a.id, { addBlocks: ["todo-999"] })).toThrow(TodoNotFoundError);
    expect(store.get(a.id).blockedBy.size).toBe(0);
    expect(store.get(a.id).blocks.size).toBe(0);
  });

  test("update on an unknown todo id throws TodoNotFoundError", () => {
    const store = new TodoStore();
    expect(() => store.update("todo-999", { status: "completed" })).toThrow(TodoNotFoundError);
  });

  test("status: 'deleted' removes the record and severs edges referencing it from other records", () => {
    const store = new TodoStore();
    const a = store.create({ subject: "A" });
    const b = store.create({ subject: "B", blockedBy: [a.id] });
    const result = store.update(a.id, { status: "deleted" });
    expect(result.record).toBeNull();
    expect(() => store.get(a.id)).toThrow(TodoNotFoundError);
    expect(store.get(b.id).blockedBy.has(a.id)).toBe(false);
    expect(store.list().map((t) => t.id)).toEqual([b.id]);
  });

  test("deleting a record frees room under the cap", () => {
    const store = new TodoStore();
    const ids: string[] = [];
    for (let i = 0; i < TodoStore.MAX_ITEMS; i++) {
      ids.push(store.create({ subject: `item ${i}` }).id);
    }
    store.update(ids[0] as string, { status: "deleted" });
    const created = store.create({ subject: "room now" });
    expect(created.subject).toBe("room now");
  });
});
