import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent } from "../contracts/index.ts";
import { SseFrameParser } from "./sse-frame-parser.ts";

// DH-0184: single shared test-vector table for the frame parser both TUI and Web consume via
// this module — previously duplicated as src/tui/sse-parser.test.ts (this exact suite) against
// an independent (and slightly less general) implementation in src/web/client/sse.test.ts.
function outputEvent(overrides: Partial<AgentOutputEvent> = {}): AgentOutputEvent {
  return {
    version: 1,
    id: "1",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "root",
    chunk: "hello",
    ...overrides,
  };
}

describe("SseFrameParser", () => {
  test("parses a single well-formed frame", () => {
    const parser = new SseFrameParser();
    const event = outputEvent();
    const raw = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    const frames = parser.push(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ id: "1", event: null, data: JSON.stringify(event) });
  });

  test("handles a frame split across multiple push() calls", () => {
    const parser = new SseFrameParser();
    const event = outputEvent();
    const raw = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    const mid = Math.floor(raw.length / 2);
    const first = parser.push(raw.slice(0, mid));
    expect(first).toHaveLength(0);
    const second = parser.push(raw.slice(mid));
    expect(second).toHaveLength(1);
    expect(second[0]?.data).toBe(JSON.stringify(event));
  });

  test("joins multi-line data fields with \\n per the SSE spec", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("data: line one\ndata: line two\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("line one\nline two");
  });

  test("tracks the event field", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("event: custom\ndata: payload\n\n");
    expect(frames[0]?.event).toBe("custom");
  });

  test("ignores comment lines starting with a colon", () => {
    const parser = new SseFrameParser();
    const frames = parser.push(": this is a comment\ndata: payload\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("payload");
  });

  test("strips a single leading space after the colon but not further spaces", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("data:  two spaces\n\n");
    expect(frames[0]?.data).toBe(" two spaces");
  });

  test("handles a field with no colon as a field name with empty value", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("data\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("");
  });

  test("a blank-line-only dispatch with no data produces no frame", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("id: 5\n\n");
    expect(frames).toHaveLength(0);
    // The id is still tracked for reconnect purposes even without a data-bearing frame.
    expect(parser.getLastEventId()).toBe("5");
  });

  test("handles \\r\\n line endings", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("id: 1\r\ndata: payload\r\n\r\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ id: "1", event: null, data: "payload" });
  });

  test("getLastEventId reflects the most recent id: field", () => {
    const parser = new SseFrameParser();
    expect(parser.getLastEventId()).toBeNull();
    parser.push("id: 1\ndata: a\n\n");
    expect(parser.getLastEventId()).toBe("1");
    parser.push("id: 2\ndata: b\n\n");
    expect(parser.getLastEventId()).toBe("2");
  });

  test("parses multiple frames delivered in one chunk", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("data: first\n\ndata: second\n\n");
    expect(frames).toHaveLength(2);
    expect(frames[0]?.data).toBe("first");
    expect(frames[1]?.data).toBe("second");
  });

  test("a frame without an id has a null id", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("data: no id here\n\n");
    expect(frames[0]?.id).toBeNull();
  });
});
