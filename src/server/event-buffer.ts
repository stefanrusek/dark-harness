import type { ServerSentEvent } from "../contracts/index.ts";

/**
 * In-memory, append-order retention buffer that makes SSE resume via `Last-Event-ID`
 * possible (ADR 0002).
 *
 * Retention window (documented per docs/handoffs/server.md, "your call, document it"):
 * bounded by event *count* (default 1000, constructor-overridable) **and**, per DH-0012,
 * by total serialized *bytes* (default 10MB, constructor-overridable) — a single large
 * `agent_output.chunk` (e.g. a big file Read echoed back) could otherwise dominate memory
 * regardless of how few events are buffered. Whichever bound is hit first evicts the
 * oldest entry first, same as the pre-existing count-based eviction, repeating until both
 * bounds are satisfied. At least one event is always retained even if it alone exceeds
 * `maxBytes` (see `push`) — a fresh connection should get best-effort replay of the latest
 * event, not an empty buffer. Neither bound is time- or disk-based:
 *   - Covers reconnects within the current process's uptime and buffer depth only.
 *   - A client resuming with an id that has already been evicted, or reconnecting after a
 *     full process restart, gets the current buffered window from the start (best effort)
 *     rather than an error — see `getEventsAfter`.
 *   - Full history beyond the buffer is only recoverable via the `download_logs` command
 *     (JSONL / tar), not the SSE channel. This is deferred, not implemented: no on-disk
 *     event-buffer spill/replay in this round.
 *
 * Follow-up needed (DH-0012, noted not implemented here): `maxSize`/`maxBytes` are
 * constructor options but aren't yet threaded through `dh.json` — `cli.ts` (Core-owned)
 * always constructs `DhServer` with the defaults today. Wiring a `dh.json` knob through to
 * `DhServerOptions.eventBufferMaxEvents`/`eventBufferMaxBytes` at that call site is a Core
 * follow-through (same shape as DH-0020's D4 cli.ts wiring), not a Server edit of `cli.ts`.
 */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

function byteSizeOf(event: ServerSentEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

export class EventBuffer {
  private readonly events: ServerSentEvent[] = [];
  private readonly sizes: number[] = [];
  private readonly idToSeq = new Map<string, number>();
  private firstSeq = 0;
  private totalBytes = 0;

  constructor(
    private readonly maxSize: number = 1000,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {
    if (maxSize < 1) {
      throw new RangeError("EventBuffer maxSize must be >= 1");
    }
    if (maxBytes < 1) {
      throw new RangeError("EventBuffer maxBytes must be >= 1");
    }
  }

  push(event: ServerSentEvent): void {
    const seq = this.firstSeq + this.events.length;
    const size = byteSizeOf(event);
    this.events.push(event);
    this.sizes.push(size);
    this.totalBytes += size;
    this.idToSeq.set(event.id, seq);
    while (
      this.events.length > 1 &&
      (this.events.length > this.maxSize || this.totalBytes > this.maxBytes)
    ) {
      const evicted = this.events.shift();
      const evictedSize = this.sizes.shift();
      if (evicted) this.idToSeq.delete(evicted.id);
      if (evictedSize !== undefined) this.totalBytes -= evictedSize;
      this.firstSeq++;
    }
  }

  /**
   * Events strictly after `lastEventId`, oldest first, plus a `gap` flag. Returns the full
   * buffered window (with `gap: true`) when `lastEventId` is given but unknown (already
   * evicted, or never seen — e.g. after a process restart) — see the class doc for why
   * "unknown" resolves to best-effort replay rather than an error. `gap` is always `false`
   * when `lastEventId` is omitted/null (a fresh connection has nothing to have missed) or
   * when it resolved to a known position.
   */
  getEventsAfter(lastEventId: string | undefined | null): {
    events: ServerSentEvent[];
    gap: boolean;
  } {
    if (!lastEventId) return { events: [...this.events], gap: false };
    const seq = this.idToSeq.get(lastEventId);
    if (seq === undefined) return { events: [...this.events], gap: true };
    const offset = seq - this.firstSeq + 1;
    return { events: this.events.slice(offset), gap: false };
  }

  get size(): number {
    return this.events.length;
  }
}
