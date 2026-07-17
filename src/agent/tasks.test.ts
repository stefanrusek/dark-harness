import { describe, expect, test } from "bun:test";
import {
  DuplicateTaskIdError,
  TaskFinishedError,
  TaskNotFoundError,
  TaskRegistry,
} from "./tasks.ts";

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

  // Round 13 (docs/handoffs/core.md): stop() on an already-terminal task now throws
  // TaskFinishedError instead of silently no-oping — lets TaskStop's tool layer distinguish
  // "already finished" from an actual stop.
  test("stop() on an already-finished task throws TaskFinishedError and leaves status untouched", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
    await registry.awaitDone(id);
    expect(() => registry.stop(id)).toThrow(TaskFinishedError);
    expect(registry.snapshot(id).status).toBe("done");
  });

  // Round 13: distinct terminal status from "failed" (contracts/log.ts's AgentStatus).
  test("stop() on a running task marks it 'stopped', not 'failed'", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({
      kind: "bash",
      parentAgentId: "root",
      run: () => new Promise(() => {}),
    });
    registry.stop(id);
    expect(registry.snapshot(id).status).toBe("stopped");
  });

  test("sendMessage() to an already-finished task throws TaskFinishedError", async () => {
    const registry = new TaskRegistry();
    const id = registry.start({
      kind: "agent",
      parentAgentId: "root",
      run: async (handle) => {
        handle.registerSendMessage(() => {});
      },
    });
    await registry.awaitDone(id);
    expect(() => registry.sendMessage(id, "hi")).toThrow(TaskFinishedError);
  });

  describe("outputSince (Round 13: incremental TaskOutput)", () => {
    test("returns only output appended since the reader's last call, and the running total", async () => {
      const registry = new TaskRegistry();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const id = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("one");
          await gate;
          handle.append("two");
        },
      });

      const firstRead = registry.outputSince(id, "reader-a");
      expect(firstRead).toEqual({ delta: "one", totalLength: 3 });

      release?.();
      await registry.awaitDone(id);

      const secondRead = registry.outputSince(id, "reader-a");
      expect(secondRead).toEqual({ delta: "two", totalLength: 6 });
    });

    test("tracks cursors independently per reader id", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("hello");
        },
      });
      await registry.awaitDone(id);

      expect(registry.outputSince(id, "reader-a").delta).toBe("hello");
      // A different reader hasn't seen anything yet, so it still gets the full output.
      expect(registry.outputSince(id, "reader-b").delta).toBe("hello");
      // reader-a has now already seen it — nothing new.
      expect(registry.outputSince(id, "reader-a").delta).toBe("");
    });
  });

  describe("unreadLength (DH-0071: Monitor's non-advancing peek)", () => {
    test("reports full output length before any read, then shrinks as outputSince advances", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("hello");
        },
      });
      await registry.awaitDone(id);

      expect(registry.unreadLength(id, "reader-a")).toBe(5);
      registry.outputSince(id, "reader-a");
      expect(registry.unreadLength(id, "reader-a")).toBe(0);
    });

    test("does not advance the reader's cursor — a later outputSince still sees the full delta", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("hello world");
        },
      });
      await registry.awaitDone(id);

      // Call unreadLength ("Monitor glance") several times — this must never consume the
      // pending delta that a subsequent outputSince ("TaskOutput") is entitled to.
      expect(registry.unreadLength(id, "reader-a")).toBe(11);
      expect(registry.unreadLength(id, "reader-a")).toBe(11);

      const { delta, totalLength } = registry.outputSince(id, "reader-a");
      expect(delta).toBe("hello world");
      expect(totalLength).toBe(11);
    });

    test("is per-reader, like outputSince's cursors", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("hi");
        },
      });
      await registry.awaitDone(id);

      registry.outputSince(id, "reader-a");
      expect(registry.unreadLength(id, "reader-a")).toBe(0);
      expect(registry.unreadLength(id, "reader-b")).toBe(2);
    });

    test("throws TaskNotFoundError for an unknown id", () => {
      const registry = new TaskRegistry();
      expect(() => registry.unreadLength("bash-999", "reader-a")).toThrow(TaskNotFoundError);
    });
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

  // DH-0012 (tracking/DH-0012-unbounded-memory-growth-across-harness.md): fixed-count cap on
  // terminal/completed tasks (and their read cursors), oldest evicted first — the default cap
  // is 50, but the constructor accepts an explicit override so these tests don't need to spin
  // up 51 tasks.
  describe("DH-0012: completed-task retention cap", () => {
    test("evicts the oldest terminal task once the cap is exceeded", async () => {
      const registry = new TaskRegistry(undefined, 2);
      const a = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(a);
      const b = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(b);
      // Cap of 2 not yet exceeded — both still present.
      expect(
        registry
          .list()
          .map((t) => t.id)
          .sort(),
      ).toEqual([a, b].sort());

      const c = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(c);
      // A third completion exceeds the cap of 2 — the oldest (a) is evicted.
      expect(registry.trySnapshot(a)).toBeUndefined();
      expect(
        registry
          .list()
          .map((t) => t.id)
          .sort(),
      ).toEqual([b, c].sort());
    });

    test("never evicts an active (non-terminal) task regardless of count", async () => {
      const registry = new TaskRegistry(undefined, 1);
      const active = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: () => new Promise(() => {}),
      });
      for (let i = 0; i < 3; i += 1) {
        const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
        await registry.awaitDone(id);
      }
      // The still-running task survives even though 3 terminal tasks have cycled through a
      // retention cap of 1.
      expect(registry.snapshot(active).status).toBe("running");
    });

    test("evicting a task also drops its per-reader read cursors", async () => {
      const registry = new TaskRegistry(undefined, 1);
      const a = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: async (handle) => {
          handle.append("hello");
        },
      });
      await registry.awaitDone(a);
      registry.outputSince(a, "reader-a");

      const b = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(b);

      // `a` has been evicted (cap of 1, `b` is newer) — its read cursor is gone too, so a
      // fresh outputSince() call for it is a brand new task id, not a stale cursor lookup.
      expect(() => registry.outputSince(a, "reader-a")).toThrow(TaskNotFoundError);
    });

    test("defaults to DEFAULT_COMPLETED_RETENTION (50) when no override is given", async () => {
      const registry = new TaskRegistry();
      const ids: string[] = [];
      for (let i = 0; i < 50; i += 1) {
        const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
        await registry.awaitDone(id);
        ids.push(id);
      }
      // Exactly at the default cap — nothing evicted yet.
      expect(registry.list()).toHaveLength(50);

      const oneMore = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(oneMore);
      // The 51st completion evicts the very first task.
      const firstId = ids[0];
      expect(firstId).toBeDefined();
      expect(registry.trySnapshot(firstId as string)).toBeUndefined();
      expect(registry.list()).toHaveLength(50);
    });

    test("a stopped task counts toward the cap and can itself be evicted", async () => {
      const registry = new TaskRegistry(undefined, 1);
      const stopped = registry.start({
        kind: "bash",
        parentAgentId: "root",
        run: () => new Promise(() => {}),
      });
      registry.stop(stopped);
      expect(registry.snapshot(stopped).status).toBe("stopped");

      const next = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(next);

      expect(registry.trySnapshot(stopped)).toBeUndefined();
      expect(registry.list().map((t) => t.id)).toEqual([next]);
    });

    test("onSettled still fires for a background task that gets evicted immediately (retention 0)", async () => {
      const settled: unknown[] = [];
      const registry = new TaskRegistry((snapshot) => settled.push(snapshot), 0);
      const id = registry.start({ kind: "bash", parentAgentId: "root", run: async () => {} });
      await registry.awaitDone(id);
      expect(settled).toHaveLength(1);
      expect((settled[0] as { id: string }).id).toBe(id);
      // Evicted immediately since the cap is 0.
      expect(registry.trySnapshot(id)).toBeUndefined();
    });
  });

  describe("clearTerminal (DH-0003: SendMessage-resume id reuse)", () => {
    test("clears a done task's entry, letting start() reuse its id", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "agent",
        parentAgentId: "root",
        id: "agent-fixed",
        run: async () => {},
      });
      await registry.awaitDone(id);
      expect(registry.trySnapshot(id)?.status).toBe("done");

      registry.clearTerminal(id);
      expect(registry.trySnapshot(id)).toBeUndefined();

      // Reusing the id no longer throws DuplicateTaskIdError.
      const reused = registry.start({
        kind: "agent",
        parentAgentId: "root",
        id,
        run: async () => {},
      });
      expect(reused).toBe(id);
    });

    test("clears a failed task's eviction-queue slot and read cursors, not just its entry", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "agent",
        parentAgentId: "root",
        id: "agent-fixed",
        run: async () => {
          throw new Error("boom");
        },
      });
      await registry.awaitDone(id);
      expect(registry.trySnapshot(id)?.status).toBe("failed");
      // Populate a read cursor for this id — clearTerminal must drop it too, or a reused id
      // would start with a stale "already read up to N chars" cursor from the finished run.
      registry.outputSince(id, "some-reader");

      registry.clearTerminal(id);

      const reused = registry.start({
        kind: "agent",
        parentAgentId: "root",
        id,
        run: async () => {},
      });
      // A fresh read cursor for the same reader starts from 0 again, not from wherever the
      // evicted run's cursor had advanced to.
      expect(registry.outputSince(reused, "some-reader").totalLength).toBe(0);
    });

    test("clearTerminal on a still-running task throws instead of abandoning live state", () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "agent",
        parentAgentId: "root",
        run: () => new Promise(() => {}),
      });
      expect(() => registry.clearTerminal(id)).toThrow(/has not finished/);
    });

    test("clearTerminal on an unknown id throws TaskNotFoundError", () => {
      const registry = new TaskRegistry();
      expect(() => registry.clearTerminal("nope")).toThrow(TaskNotFoundError);
    });
  });

  describe("hasNonTerminalChildren (DH-0140: nudge-suppression check)", () => {
    test("true while a directly-spawned child (agent-kind) is still running", () => {
      const registry = new TaskRegistry();
      registry.start({
        kind: "agent",
        parentAgentId: "parent",
        run: () => new Promise(() => {}),
      });
      expect(registry.hasNonTerminalChildren("parent")).toBe(true);
    });

    test("true while a directly-spawned child (bash-kind) is still running", () => {
      const registry = new TaskRegistry();
      registry.start({
        kind: "bash",
        parentAgentId: "parent",
        run: () => new Promise(() => {}),
      });
      expect(registry.hasNonTerminalChildren("parent")).toBe(true);
    });

    test("true while a directly-spawned child is 'waiting' (not just 'running')", () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "agent",
        parentAgentId: "parent",
        run: () => new Promise(() => {}),
      });
      registry.setStatus(id, "waiting");
      expect(registry.hasNonTerminalChildren("parent")).toBe(true);
    });

    test("false once every directly-spawned child has reached a terminal status", async () => {
      const registry = new TaskRegistry();
      const id = registry.start({
        kind: "bash",
        parentAgentId: "parent",
        run: async () => {},
      });
      await registry.awaitDone(id);
      expect(registry.hasNonTerminalChildren("parent")).toBe(false);
    });

    test("false for a parent with no children at all", () => {
      const registry = new TaskRegistry();
      expect(registry.hasNonTerminalChildren("parent")).toBe(false);
    });

    test("ignores grandchildren — only direct children count", async () => {
      const registry = new TaskRegistry();
      const childId = registry.start({
        kind: "agent",
        parentAgentId: "parent",
        run: async () => {},
      });
      await registry.awaitDone(childId);
      registry.start({
        kind: "bash",
        parentAgentId: childId,
        run: () => new Promise(() => {}),
      });
      expect(registry.hasNonTerminalChildren("parent")).toBe(false);
    });
  });
});
