import type { ServerSentEvent } from "../contracts/index.ts";

/**
 * In-memory, append-order retention buffer that makes SSE resume via `Last-Event-ID`
 * possible (ADR 0002).
 *
 * Retention window (documented per docs/handoffs/server.md, "your call, document it"):
 * bounded by event *count* (default 1000, constructor-overridable), not time or disk. This
 * is a deliberate, explicitly-scoped limitation:
 *   - Covers reconnects within the current process's uptime and buffer depth only.
 *   - A client resuming with an id that has already been evicted, or reconnecting after a
 *     full process restart, gets the current buffered window from the start (best effort)
 *     rather than an error — see `getEventsAfter`.
 *   - Full history beyond the buffer is only recoverable via the `download_logs` command
 *     (JSONL / tar), not the SSE channel. This is deferred, not implemented: no on-disk
 *     event-buffer spill/replay in this round.
 */
export class EventBuffer {
  private readonly events: ServerSentEvent[] = [];
  private readonly idToSeq = new Map<string, number>();
  private firstSeq = 0;

  constructor(private readonly maxSize: number = 1000) {
    if (maxSize < 1) {
      throw new RangeError("EventBuffer maxSize must be >= 1");
    }
  }

  push(event: ServerSentEvent): void {
    const seq = this.firstSeq + this.events.length;
    this.events.push(event);
    this.idToSeq.set(event.id, seq);
    if (this.events.length > this.maxSize) {
      const evicted = this.events.shift();
      if (evicted) this.idToSeq.delete(evicted.id);
      this.firstSeq++;
    }
  }

  /**
   * Events strictly after `lastEventId`, oldest first. Returns the full buffered window
   * when `lastEventId` is omitted/null, or when it is unknown (already evicted, or never
   * seen by this buffer) — see the class doc for why "unknown" resolves to best-effort
   * replay rather than an error.
   */
  getEventsAfter(lastEventId: string | undefined | null): ServerSentEvent[] {
    if (!lastEventId) return [...this.events];
    const seq = this.idToSeq.get(lastEventId);
    if (seq === undefined) return [...this.events];
    const offset = seq - this.firstSeq + 1;
    return this.events.slice(offset);
  }

  get size(): number {
    return this.events.length;
  }
}
