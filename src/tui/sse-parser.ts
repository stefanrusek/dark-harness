// Hand-rolled text/event-stream parser (the console client is not a browser, so no
// EventSource). Two layers:
//   1. SseFrameParser: incremental byte/text feed -> raw SSE frames (id/event/data),
//      per the WHATWG SSE field-parsing rules (blank-line-terminated, multi-line `data:`
//      joined with `\n`).
//   2. parseServerSentEvent: raw frame -> a validated `ServerSentEvent` from the shared
//      contracts, since our wire convention is one JSON object per event in `data:`.

import type { ServerSentEvent } from "../contracts/index.ts";

export interface RawSseFrame {
  id: string | null;
  event: string | null;
  data: string;
}

/**
 * Incremental parser: feed it text chunks as they arrive from the network; it returns any
 * frames completed by that chunk (a chunk boundary may land mid-line or mid-frame).
 */
export class SseFrameParser {
  private buffer: string;
  private fieldId: string | null;
  private fieldEvent: string | null;
  private dataLines: string[];
  private lastEventId: string | null;

  constructor() {
    this.buffer = "";
    this.fieldId = null;
    this.fieldEvent = null;
    this.dataLines = [];
    this.lastEventId = null;
  }

  /** The most recently seen `id:` field, for `Last-Event-ID` on reconnect. */
  getLastEventId(): string | null {
    return this.lastEventId;
  }

  push(chunk: string): RawSseFrame[] {
    this.buffer += chunk;
    const frames: RawSseFrame[] = [];
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        const frame = this.dispatch();
        if (frame) frames.push(frame);
      } else {
        this.consumeLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
    return frames;
  }

  private consumeLine(line: string): void {
    if (line.startsWith(":")) return; // comment
    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") {
      this.dataLines.push(value);
    } else if (field === "id") {
      this.fieldId = value;
    } else if (field === "event") {
      this.fieldEvent = value;
    }
    // Other fields (e.g. `retry`) are accepted but not surfaced — no reconnect-delay
    // override is part of this domain's scope.
  }

  private dispatch(): RawSseFrame | null {
    if (this.fieldId !== null) this.lastEventId = this.fieldId;
    if (this.dataLines.length === 0) {
      this.fieldId = null;
      this.fieldEvent = null;
      return null;
    }
    const frame: RawSseFrame = {
      id: this.fieldId,
      event: this.fieldEvent,
      data: this.dataLines.join("\n"),
    };
    this.dataLines = [];
    this.fieldId = null;
    this.fieldEvent = null;
    return frame;
  }
}

/**
 * Parse a raw frame's `data:` payload as a `ServerSentEvent`. Returns `null` (rather than
 * throwing) on malformed JSON or an unrecognized shape, so a single bad frame doesn't take
 * down the client — callers should surface a status message instead of crashing.
 */
export function parseServerSentEvent(frame: RawSseFrame): ServerSentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isServerSentEvent(parsed)) return null;
  return parsed;
}

const KNOWN_TYPES = new Set([
  "agent_output",
  "agent_status",
  "agent_spawned",
  "token_usage",
  "session_ended",
  "tool_call",
  "tool_result",
]);

function isServerSentEvent(value: unknown): value is ServerSentEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.type === "string" &&
    KNOWN_TYPES.has(record.type)
  );
}
