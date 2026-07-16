// In-process task registry shared by the tools that create or observe async work: Bash
// (run_in_background), Agent (spawns), and the coordination tools Monitor / TaskOutput /
// SendMessage / TaskStop that operate over whatever a prior Bash/Agent call started.
//
// Scope for this round (per docs/handoffs/core.md): single-process, in-memory only —
// sub-agents run as concurrent async tasks within the same process, no distributed
// execution. This registry is the shared substrate that makes that work.

import type { AgentStatus } from "../contracts/index.ts";

export type TaskKind = "bash" | "agent";

export interface TaskSnapshot {
  id: string;
  kind: TaskKind;
  parentAgentId: string;
  status: AgentStatus;
  output: string;
  model?: string;
  /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label, from the Agent
   * tool's optional `description` param — surfaced in Monitor output and the agent tree. */
  description?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
}

export interface TaskRunHandle {
  append(chunk: string): void;
  signal: AbortSignal;
  /** Agent-kind tasks call this to make themselves reachable by SendMessage. */
  registerSendMessage(fn: (message: string) => void): void;
}

export interface StartTaskParams {
  kind: TaskKind;
  parentAgentId: string;
  model?: string;
  /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label threaded from the
   * Agent tool's optional `description` param, through to TaskSnapshot/Monitor/agent tree. */
  description?: string;
  /** Caller-supplied id, overriding the registry's own counter-based generation. Used by
   * AgentRuntime.spawnAgent() so the task registry's id for an agent-kind task IS the same
   * identifier the agent loop uses for its own SSE events/log lines (see runtime.ts and
   * docs/handoffs/core.md's Round 2 status log for why this unification matters — it's what
   * lets Server's AgentLoopHandle.sendMessage/stopAgent/getAgentTree operate on one
   * consistent "agentId" instead of needing a translation table). */
  id?: string;
  /** Round 12 (docs/handoffs/core.md): whether this task was started as `run_in_background:
   * true`. Defaults to `true` when omitted. Only background tasks fire the registry's
   * `onSettled` completion-notification callback on the constructor — a foreground call
   * already blocks on `awaitDone()` and gets its result synchronously as the tool's own
   * return value, so a second push-notification into the same turn would be redundant. */
  background?: boolean;
  run: (handle: TaskRunHandle) => Promise<void>;
}

export class DuplicateTaskIdError extends Error {
  constructor(id: string) {
    super(`task id already in use: ${id}`);
    this.name = "DuplicateTaskIdError";
  }
}

interface InternalTask {
  id: string;
  kind: TaskKind;
  parentAgentId: string;
  status: AgentStatus;
  chunks: string[];
  model?: string;
  description?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
  controller: AbortController;
  sendMessage?: (message: string) => void;
  done: Promise<void>;
  background: boolean;
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown task id: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

/** Round 13 (docs/handoffs/core.md): thrown by stop()/sendMessage() when the target task has
 * already reached a terminal status ("done" | "failed" | "stopped") — lets TaskStop report
 * "already finished" instead of a false "Stopped" claim, and SendMessage refuse with a clear
 * reason instead of silently dropping the message into a `pendingMessages` array nobody reads
 * again (the bug this round's audit found). */
export class TaskFinishedError extends Error {
  constructor(id: string, status: AgentStatus) {
    super(`task ${id} has already finished (status: ${status})`);
    this.name = "TaskFinishedError";
  }
}

/** DH-0012 (tracking/DH-0012-unbounded-memory-growth-across-harness.md): default cap on
 * terminal/completed tasks retained before the oldest are evicted, when `dh.json`'s
 * `limits.completedRetention` is omitted. */
export const DEFAULT_COMPLETED_RETENTION = 50;

export class TaskRegistry {
  private tasks = new Map<string, InternalTask>();
  private counter = 0;
  // Round 13 (docs/handoffs/core.md): per-(task, reader) read cursor backing TaskOutput's
  // incremental delta — outer key is the task id, inner key is the calling agent's own id
  // (ctx.agentId), value is how many chars of that task's accumulated output this reader has
  // already been shown. Deliberately per-reader, not a single cursor per task: nothing in the
  // tool contract limits polling to one caller, and a second reader (e.g. a sibling sub-agent
  // also watching the same background Bash task) should still see its own "what's new to me."
  private readCursors = new Map<string, Map<string, number>>();
  // DH-0012: FIFO of task ids that have reached a terminal status ("done" | "failed" |
  // "stopped"), in the order they terminated — the eviction queue. `terminalIds` guards
  // against double-counting a task that could otherwise be noted terminal twice (e.g.
  // stop() sets "stopped" synchronously, then the aborted run's rejection settles through
  // the same .catch() branch that would otherwise re-note it).
  private completedOrder: string[] = [];
  private terminalIds = new Set<string>();

  /** Round 12 (docs/handoffs/core.md): fired once, after a *background* task's `run` has
   * settled (success or failure), with its final snapshot — the hook AgentRuntime uses to
   * push a completion notification into the parent agent's conversation. Foreground tasks
   * (background: false) never fire this — see StartTaskParams.background's doc comment.
   *
   * DH-0012: `completedRetention` (default `DEFAULT_COMPLETED_RETENTION`) bounds how many
   * terminal tasks (and their captured output `chunks`/read cursors) this registry keeps —
   * oldest evicted first, active (non-terminal) tasks never evicted regardless of count. */
  constructor(
    private readonly onSettled?: (snapshot: TaskSnapshot) => void,
    private readonly completedRetention: number = DEFAULT_COMPLETED_RETENTION,
  ) {}

  /** DH-0012: records a task's transition to a terminal status in eviction order, then evicts
   * the oldest terminal entries (task + its read cursors) beyond `completedRetention`. Called
   * exactly once per task, at each of the three places a task becomes terminal (the success
   * path, the failure path, and stop()) — `terminalIds` makes a duplicate call a no-op so a
   * task already evicted (or already queued) is never double-counted or re-added. */
  private noteTerminal(id: string): void {
    if (this.terminalIds.has(id)) return;
    // Already evicted (e.g. stop() queued it once under a tiny retention cap, and a later
    // branch above calls noteTerminal again) — don't resurrect a phantom entry in the
    // eviction queue for a task no longer in `tasks`.
    if (!this.tasks.has(id)) return;
    this.terminalIds.add(id);
    this.completedOrder.push(id);
    while (this.completedOrder.length > this.completedRetention) {
      const oldest = this.completedOrder.shift();
      if (oldest === undefined) break;
      this.tasks.delete(oldest);
      this.readCursors.delete(oldest);
      this.terminalIds.delete(oldest);
    }
  }

  private nextId(kind: TaskKind): string {
    this.counter += 1;
    return `${kind}-${this.counter}`;
  }

  /** Starts a task and returns its id immediately; `run` executes concurrently. */
  start(params: StartTaskParams): string {
    if (params.id !== undefined && this.tasks.has(params.id)) {
      throw new DuplicateTaskIdError(params.id);
    }
    const id = params.id ?? this.nextId(params.kind);
    const controller = new AbortController();
    const task: InternalTask = {
      id,
      kind: params.kind,
      parentAgentId: params.parentAgentId,
      status: "running",
      chunks: [],
      createdAt: new Date().toISOString(),
      controller,
      done: Promise.resolve(),
      background: params.background ?? true,
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
    };
    this.tasks.set(id, task);

    const handle: TaskRunHandle = {
      append: (chunk: string) => {
        task.chunks.push(chunk);
      },
      signal: controller.signal,
      registerSendMessage: (fn: (message: string) => void) => {
        task.sendMessage = fn;
      },
    };

    // DH-0012: captured by the two branches below, right when task.status/error/finishedAt
    // are finalized but before noteTerminal() could ever evict this task (possible with a
    // very small completedRetention, e.g. 0) — so the final .then()'s onSettled call always
    // gets the real final snapshot, never an eviction-induced "already gone" gap.
    let finalSnapshot: TaskSnapshot | undefined;

    task.done = params
      .run(handle)
      .then(() => {
        if (task.status === "running") {
          task.status = "done";
        }
        task.finishedAt = new Date().toISOString();
        finalSnapshot = this.snapshot(id);
        // task.status is terminal one way or another by this point (freshly "done", or
        // already "stopped" if stop() raced this branch) — queue it for eviction.
        this.noteTerminal(id);
      })
      .catch((err: unknown) => {
        // Round 13: stop() already set status to "stopped" (and finishedAt) synchronously
        // before aborting the controller — the run's promise then rejects (typically from
        // the abort) shortly after. Don't let that rejection overwrite a deliberate stop
        // with "failed"; a stopped task should stay "stopped", not look like a fault.
        if (task.status !== "stopped") {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
          task.finishedAt = new Date().toISOString();
        }
        finalSnapshot = this.snapshot(id);
        // Terminal either way ("failed" just set above, or "stopped" already set) — queue it
        // for eviction (noteTerminal is a no-op if stop() already queued this id).
        this.noteTerminal(id);
      })
      .then(() => {
        // Round 12: fires after the branches above have settled task.status/error/finishedAt,
        // regardless of which branch ran (the .catch above never rethrows) — so this always
        // observes the final snapshot, not a mid-settle one.
        if (task.background && finalSnapshot) {
          this.onSettled?.(finalSnapshot);
        }
      });

    return id;
  }

  private require(id: string): InternalTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return task;
  }

  /** Resolves once the task's `run` function has settled (success or failure). */
  async awaitDone(id: string): Promise<void> {
    await this.require(id).done;
  }

  snapshot(id: string): TaskSnapshot {
    const task = this.require(id);
    const snapshot: TaskSnapshot = {
      id: task.id,
      kind: task.kind,
      parentAgentId: task.parentAgentId,
      status: task.status,
      output: task.chunks.join(""),
      createdAt: task.createdAt,
      ...(task.model !== undefined ? { model: task.model } : {}),
      ...(task.description !== undefined ? { description: task.description } : {}),
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      ...(task.error !== undefined ? { error: task.error } : {}),
    };
    return snapshot;
  }

  /** Non-throwing snapshot lookup — Round 12's completion-notification delivery uses this to
   * check whether a parent agentId corresponds to a currently-tracked task without needing a
   * try/catch at every call site (unlike `snapshot()`, returns undefined instead of throwing
   * `TaskNotFoundError` for an unknown id — e.g. the root, which isn't a task at all). */
  trySnapshot(id: string): TaskSnapshot | undefined {
    return this.tasks.has(id) ? this.snapshot(id) : undefined;
  }

  monitor(ids: string[]): TaskSnapshot[] {
    return ids.map((id) => this.snapshot(id));
  }

  /** Marks the task's status explicitly (e.g. an agent-kind task reporting "waiting"). */
  setStatus(id: string, status: AgentStatus): void {
    this.require(id).status = status;
  }

  /** Round 13 (docs/handoffs/core.md): stopping a task now records a distinct terminal
   * "stopped" status instead of overloading "failed" (see AgentStatus's doc comment in
   * contracts/log.ts), and throws TaskFinishedError — rather than silently no-oping — when
   * the task has already reached a terminal status, so TaskStop's tool layer can report
   * "already finished" instead of a false "Stopped `<id>`" claim. */
  stop(id: string): void {
    const task = this.require(id);
    if (task.status !== "running" && task.status !== "waiting") {
      throw new TaskFinishedError(id, task.status);
    }
    task.controller.abort();
    task.status = "stopped";
    task.finishedAt = new Date().toISOString();
    // DH-0012: queue for eviction now — the async .then/.catch chain will also call
    // noteTerminal(id) once the aborted run's promise settles, but that's a no-op by then.
    this.noteTerminal(id);
  }

  /** Round 13 (docs/handoffs/core.md): refuses (TaskFinishedError) once the task has reached
   * a terminal status, instead of the previous silent-drop bug — the registered
   * `sendMessage` sink is never cleared after a task/agent finishes (see runtime.ts's
   * `tryDeliverToAgent` doc comment for why that's true elsewhere too), so without this check
   * the call would appear to succeed while the message landed nowhere anyone will ever read. */
  sendMessage(id: string, message: string): void {
    const task = this.require(id);
    if (task.status !== "running" && task.status !== "waiting") {
      throw new TaskFinishedError(id, task.status);
    }
    if (!task.sendMessage) {
      throw new Error(
        `task ${id} does not accept messages (not an agent task, or not yet listening)`,
      );
    }
    task.sendMessage(message);
  }

  /** Round 13 (docs/handoffs/core.md): incremental read backing TaskOutput — returns only the
   * output chars appended since `readerId`'s last call for this task id, plus the running
   * total length (for the "N chars total" notice). Advances the cursor as a side effect;
   * callers that want the full buffer every time should not use this (TaskOutput's `full`
   * param bypasses it entirely). */
  outputSince(id: string, readerId: string): { delta: string; totalLength: number } {
    const task = this.require(id);
    const full = task.chunks.join("");
    let perTask = this.readCursors.get(id);
    if (!perTask) {
      perTask = new Map<string, number>();
      this.readCursors.set(id, perTask);
    }
    const previous = perTask.get(readerId) ?? 0;
    perTask.set(readerId, full.length);
    return { delta: full.slice(previous), totalLength: full.length };
  }

  /** DH-0071: how many chars of task `id`'s output `readerId` has not yet retrieved via
   * outputSince() — a read-only peek that does NOT advance the reader's cursor. Monitor uses
   * this so a status glance can never swallow a pending TaskOutput delta: the two methods
   * read the same `readCursors` entry, but only outputSince() writes to it. */
  unreadLength(id: string, readerId: string): number {
    const task = this.require(id);
    const total = task.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const previous = this.readCursors.get(id)?.get(readerId) ?? 0;
    return total - previous;
  }

  /** All tasks spawned (directly or transitively tracked) — used by the agent tree. */
  list(): TaskSnapshot[] {
    return [...this.tasks.keys()].map((id) => this.snapshot(id));
  }
}
