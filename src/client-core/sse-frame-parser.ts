// Hand-rolled text/event-stream field parser, shared by the TUI and Web clients — DH-0184
// extracted this out of `src/tui/sse-parser.ts` (Web's `src/web/client/sse.ts` had an
// independent, slightly less general re-implementation that only tracked `id`/`data`; this
// version also tracks the `event` field, a strict superset). Neither client uses the browser's
// native `EventSource` — see DH-0170's architect decomposition notes and the two clients'
// migration tickets (DH-0185/DH-0186) for why: `EventSource` cannot set custom headers, which
// the Web client's bearer-token auth requires.
//
// Incremental byte/text feed -> raw SSE frames (id/event/data), per the WHATWG SSE
// field-parsing rules (blank-line-terminated, multi-line `data:` joined with `\n`).

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
    // Normalize CRLF to LF up front — the SSE spec permits CRLF line endings even though our
    // own server (`formatSseEvent`) only ever emits LF; normalizing keeps this parser correct
    // against any spec-conforming producer.
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const frames: RawSseFrame[] = [];
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

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
