// TodoStore — per-agent, in-memory, self-authored plan/checklist store backing the
// TodoCreate/TodoGet/TodoList/TodoUpdate tool family (DH-0076,
// tracking/DH-0076-no-taskcreate-tasklist-taskget-taskupdate-equivalent-structured-todo-plan-tracking-for-the-main-agent.md).
//
// Deliberately NOT TaskRegistry (src/agent/tasks.ts): TaskRegistry supervises real
// concurrent processes (abort controllers, output buffers, message sinks) for background
// Bash/sub-agent jobs; this is a dumb ordered map of self-authored planning records with
// zero execution semantics. No shared code, no shared id space — ids here are `todo-N`,
// visibly disjoint from TaskRegistry's `bash-N`/`agent-N` even in prose.
//
// One store per agent per conversation: created fresh in AgentRuntime.buildToolContext()
// (same per-agent-lifetime scoping precedent as ToolContext's readRegistry/activatedTools),
// lives on the agent-loop's ToolContext, survives across turns for that agent's whole
// conversation, dies with the agent. No filesystem persistence, no cross-agent sharing.

export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface TodoRecord {
  id: string;
  status: TodoStatus;
  subject: string;
  description?: string;
  activeForm?: string;
  /** Ids of todos that should complete before this one (this todo's dependencies). */
  blockedBy: Set<string>;
  /** Derived inverse of blockedBy: ids of todos that depend on this one. */
  blocks: Set<string>;
  createdAt: string;
  updatedAt: string;
}

export class TodoNotFoundError extends Error {
  constructor(id: string) {
    super(`no such todo: ${id}`);
  }
}

export class TodoCapExceededError extends Error {
  constructor(cap: number) {
    super(`todo cap of ${cap} reached; complete or delete existing todos before creating more`);
  }
}

export interface TodoCreateParams {
  subject: string;
  description?: string;
  activeForm?: string;
  blockedBy?: string[];
}

export interface TodoUpdateParams {
  status?: TodoStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  addBlockedBy?: string[];
  removeBlockedBy?: string[];
  addBlocks?: string[];
  removeBlocks?: string[];
}

export interface TodoUpdateResult {
  /** The updated record, or null when the update deleted it. */
  record: TodoRecord | null;
  /** Set when completing a todo that still has incomplete blockers (advisory only). */
  warning?: string;
}

export class TodoStore {
  static readonly MAX_ITEMS = 200;

  private items = new Map<string, TodoRecord>();
  private counter = 0;

  private nextId(): string {
    this.counter += 1;
    return `todo-${this.counter}`;
  }

  private mustGet(id: string): TodoRecord {
    const record = this.items.get(id);
    if (!record) throw new TodoNotFoundError(id);
    return record;
  }

  create(params: TodoCreateParams): TodoRecord {
    if (this.items.size >= TodoStore.MAX_ITEMS) {
      throw new TodoCapExceededError(TodoStore.MAX_ITEMS);
    }
    // Validate referenced blockers exist before creating anything (no partial state).
    for (const blockerId of params.blockedBy ?? []) {
      this.mustGet(blockerId);
    }

    const id = this.nextId();
    const now = new Date().toISOString();
    const record: TodoRecord = {
      id,
      status: "pending",
      subject: params.subject,
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.activeForm !== undefined ? { activeForm: params.activeForm } : {}),
      blockedBy: new Set(params.blockedBy ?? []),
      blocks: new Set(),
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(id, record);
    for (const blockerId of record.blockedBy) {
      this.mustGet(blockerId).blocks.add(id);
    }
    return record;
  }

  get(id: string): TodoRecord {
    return this.mustGet(id);
  }

  /** Ordered by creation (insertion order of the backing Map). */
  list(): TodoRecord[] {
    return [...this.items.values()];
  }

  update(id: string, params: TodoUpdateParams): TodoUpdateResult {
    const record = this.mustGet(id);

    // Validate every referenced id up front — an unknown id in any edge param is an error,
    // and validating first avoids applying a partial set of edges before failing.
    for (const otherId of [...(params.addBlockedBy ?? []), ...(params.addBlocks ?? [])]) {
      this.mustGet(otherId);
    }

    if (params.subject !== undefined) record.subject = params.subject;
    if (params.description !== undefined) record.description = params.description;
    if (params.activeForm !== undefined) record.activeForm = params.activeForm;

    for (const otherId of params.addBlockedBy ?? []) {
      record.blockedBy.add(otherId);
      this.mustGet(otherId).blocks.add(id);
    }
    for (const otherId of params.removeBlockedBy ?? []) {
      record.blockedBy.delete(otherId);
      this.items.get(otherId)?.blocks.delete(id);
    }
    for (const otherId of params.addBlocks ?? []) {
      record.blocks.add(otherId);
      this.mustGet(otherId).blockedBy.add(id);
    }
    for (const otherId of params.removeBlocks ?? []) {
      record.blocks.delete(otherId);
      this.items.get(otherId)?.blockedBy.delete(id);
    }

    let warning: string | undefined;
    if (params.status !== undefined) {
      if (params.status === "deleted") {
        record.updatedAt = new Date().toISOString();
        this.deleteRecord(id);
        return { record: null };
      }
      if (params.status === "completed") {
        const openBlockers = [...record.blockedBy].filter(
          (blockerId) => this.items.get(blockerId)?.status !== "completed",
        );
        if (openBlockers.length > 0) {
          warning = `completed with unresolved blockers: ${openBlockers.join(", ")}`;
        }
      }
      record.status = params.status;
    }
    record.updatedAt = new Date().toISOString();

    return { record, ...(warning ? { warning } : {}) };
  }

  private deleteRecord(id: string): void {
    this.items.delete(id);
    for (const other of this.items.values()) {
      other.blockedBy.delete(id);
      other.blocks.delete(id);
    }
  }
}
