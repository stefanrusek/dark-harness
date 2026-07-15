import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent } from "../contracts/index.ts";
import { EventBuffer } from "./event-buffer.ts";

function evt(id: string): AgentOutputEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "a1",
    chunk: id,
  };
}

describe("EventBuffer", () => {
  test("rejects a non-positive maxSize", () => {
    expect(() => new EventBuffer(0)).toThrow(RangeError);
    expect(() => new EventBuffer(-1)).toThrow(RangeError);
  });

  test("returns the full window with gap: false when no lastEventId is given", () => {
    const buf = new EventBuffer(10);
    buf.push(evt("1"));
    buf.push(evt("2"));
    expect(buf.getEventsAfter(undefined)).toEqual({ events: [evt("1"), evt("2")], gap: false });
    expect(buf.getEventsAfter(null)).toEqual({ events: [evt("1"), evt("2")], gap: false });
    expect(buf.getEventsAfter("")).toEqual({ events: [evt("1"), evt("2")], gap: false });
  });

  test("returns events strictly after a known id, with gap: false", () => {
    const buf = new EventBuffer(10);
    buf.push(evt("1"));
    buf.push(evt("2"));
    buf.push(evt("3"));
    expect(buf.getEventsAfter("1")).toEqual({ events: [evt("2"), evt("3")], gap: false });
    expect(buf.getEventsAfter("3")).toEqual({ events: [], gap: false });
  });

  test("falls back to the full current window for an unknown id, flagged gap: true (best effort)", () => {
    const buf = new EventBuffer(10);
    buf.push(evt("1"));
    buf.push(evt("2"));
    expect(buf.getEventsAfter("never-seen")).toEqual({
      events: [evt("1"), evt("2")],
      gap: true,
    });
  });

  test("evicts the oldest event once maxSize is exceeded, and forgets its id", () => {
    const buf = new EventBuffer(2);
    buf.push(evt("1"));
    buf.push(evt("2"));
    buf.push(evt("3"));
    expect(buf.size).toBe(2);
    expect(buf.getEventsAfter(undefined)).toEqual({ events: [evt("2"), evt("3")], gap: false });
    // "1" has been evicted: resuming from it is now indistinguishable from "unknown", so
    // it falls back to the full (now-smaller) window flagged as a gap rather than erroring.
    expect(buf.getEventsAfter("1")).toEqual({ events: [evt("2"), evt("3")], gap: true });
  });

  test("continues correct sequencing across multiple evictions", () => {
    const buf = new EventBuffer(2);
    for (let i = 1; i <= 5; i++) buf.push(evt(String(i)));
    expect(buf.getEventsAfter(undefined)).toEqual({ events: [evt("4"), evt("5")], gap: false });
    expect(buf.getEventsAfter("4")).toEqual({ events: [evt("5")], gap: false });
  });
});
