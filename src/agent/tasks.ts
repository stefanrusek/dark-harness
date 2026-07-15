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
  run: (handle: TaskRunHandle) => Promise<void>;
}

interface InternalTask {
  id: string;
  kind: TaskKind;
  parentAgentId: string;
  status: AgentStatus;
  chunks: string[];
  model?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
  controller: AbortController;
  sendMessage?: (message: string) => void;
  done: Promise<void>;
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown task id: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskRegistry {
  private tasks = new Map<string, InternalTask>();
  private counter = 0;

  private nextId(kind: TaskKind): string {
    this.counter += 1;
    return `${kind}-${this.counter}`;
  }

  /** Starts a task and returns its id immediately; `run` executes concurrently. */
  start(params: StartTaskParams): string {
    const id = this.nextId(params.kind);
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
      ...(params.model !== undefined ? { model: params.model } : {}),
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

    task.done = params
      .run(handle)
      .then(() => {
        if (task.status === "running") {
          task.status = "done";
        }
        task.finishedAt = new Date().toISOString();
      })
      .catch((err: unknown) => {
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
        task.finishedAt = new Date().toISOString();
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
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      ...(task.error !== undefined ? { error: task.error } : {}),
    };
    return snapshot;
  }

  monitor(ids: string[]): TaskSnapshot[] {
    return ids.map((id) => this.snapshot(id));
  }

  /** Marks the task's status explicitly (e.g. an agent-kind task reporting "waiting"). */
  setStatus(id: string, status: AgentStatus): void {
    this.require(id).status = status;
  }

  stop(id: string): void {
    const task = this.require(id);
    task.controller.abort();
    if (task.status === "running" || task.status === "waiting") {
      task.status = "failed";
      task.error = "stopped by TaskStop";
      task.finishedAt = new Date().toISOString();
    }
  }

  sendMessage(id: string, message: string): void {
    const task = this.require(id);
    if (!task.sendMessage) {
      throw new Error(
        `task ${id} does not accept messages (not an agent task, or not yet listening)`,
      );
    }
    task.sendMessage(message);
  }

  /** All tasks spawned (directly or transitively tracked) — used by the agent tree. */
  list(): TaskSnapshot[] {
    return [...this.tasks.keys()].map((id) => this.snapshot(id));
  }
}
