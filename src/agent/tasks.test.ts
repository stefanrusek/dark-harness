import { describe, expect, test } from "bun:test";
import { DuplicateTaskIdError, TaskNotFoundError, TaskRegistry } from "./tasks.ts";

describe("TaskRegistry", () => {
  test("start assigns incrementing ids per kind", () => {
    const registry = new TaskRegistry();
    const a = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    const b = registry.start({ kind: "agent", parentAgentId: "root", run: async () => {} });
    expect(a).toBe("bash-1");
    expect(b).toBe("agent-2");
  });

  test("monitor() returns snapshots for a batch of ids", async () => {
    const registry = new TaskRegistry();
    const a = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    const b = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(a);
    await registry.awaitDone(b);
    const snapshots = registry.monitor([a, b]);
    expect(snapshots.map((s) => s.status)).toEqual(["done", "done"]);
  });

  test("setStatus overrides a task's reported status (e.g. agent reporting 'waiting')", () => {
    const registry = new TaskRegistry();
    const id = registry.start({
      kind: "agent",
      parentAgentId: "root",
      run: () => new Promise(() => {}),
    });
    registry.setStatus(id, "waiting");
    expect(registry.snapshot(id).status).toBe("waiting");
  });

  test("setStatus on an unknown id throws TaskNotFoundError", () => {
    const registry = new TaskRegistry();
    expect(() => registry.setStatus("bash-999", "waiting")).toThrow(TaskNotFoundError);
  });

  test("list() returns every registered task", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(id);
    expect(registry.list().map((t) => t.id)).toEqual([id]);
  });

  test("stop() on an already-finished task leaves its status untouched", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(id);
    registry.stop(id);
    expect(registry.snapshot(id).status).toBe("done");
  });

  test("awaitDone on an unknown id throws TaskNotFoundError", async () => {
    const registry = new TaskRegistry();
    await expect(registry.awaitDone("bash-999")).rejects.toThrow(TaskNotFoundError);
  });

  test("start() honors a caller-supplied id instead of generating one (Round 2: identifier unification)", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({
      kind: "agent",
      parentAgentId: "root",
      id: "agent-custom-uuid",
      run: async () => {},
    });
    expect(id).toBe("agent-custom-uuid");
    await registry.awaitDone(id);
    expect(registry.snapshot(id).id).toBe("agent-custom-uuid");
  });

  test("start() rejects a caller-supplied id that's already in use", () => {
    const registry = new TaskRegistry();
    registry.start({
      kind: "agent",
      parentAgentId: "root",
      id: "agent-dup",
      run: () => new Promise(() => {}),
    });
    expect(() =>
      registry.start({
        kind: "agent",
        parentAgentId: "root",
        id: "agent-dup",
        run: async () => {},
      }),
    ).toThrow(DuplicateTaskIdError);
  });

  test("start() still auto-generates ids for callers that don't supply one, unaffected by the id option existing", () => {
    const registry = new TaskRegistry();
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    expect(id).toBe("bash-1");
  });
});
