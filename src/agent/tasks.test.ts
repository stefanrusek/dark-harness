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

  // Round 12 (docs/handoffs/core.md): the onSettled hook AgentRuntime uses to push a
  // completion notification into a task's parent conversation.
  test("onSettled fires with the final snapshot once a background task settles successfully", async () => {
    const settled: unknown[] = [];
    const registry = new TaskRegistry((snapshot) => settled.push(snapshot));
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(id);
    expect(settled).toEqual([registry.snapshot(id)]);
    expect(registry.snapshot(id).status).toBe("done");
  });

  test("onSettled fires with a 'failed' snapshot (including the error) when a background task's run rejects", async () => {
    const settled: { status: string; error?: string }[] = [];
    const registry = new TaskRegistry((snapshot) => settled.push(snapshot));
    const id = registry.start({
      kind: "agent",
      parentAgentId: "root",
      run: async () => {
        throw new Error("boom");
      },
    });
    await registry.awaitDone(id);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.status).toBe("failed");
    expect(settled[0]?.error).toBe("boom");
  });

  test("onSettled does NOT fire for a foreground (background: false) task", async () => {
    const settled: unknown[] = [];
    const registry = new TaskRegistry((snapshot) => settled.push(snapshot));
    const id = registry.start({
      kind: "bash",
      parentAgentId: "root",
      background: false,
      run: async () => {},
    });
    await registry.awaitDone(id);
    expect(settled).toEqual([]);
  });

  test("trySnapshot returns undefined for an unknown id instead of throwing", () => {
    const registry = new TaskRegistry();
    expect(registry.trySnapshot("bash-999")).toBeUndefined();
  });

  test("trySnapshot returns the same snapshot snapshot() would, for a known id", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(id);
    expect(registry.trySnapshot(id)).toEqual(registry.snapshot(id));
  });
});
