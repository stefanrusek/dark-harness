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

function evtWithChunk(id: string, chunk: string): AgentOutputEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "a1",
    chunk,
  };
}

describe("EventBuffer", () => {
  test("rejects a non-positive maxSize", () => {
    expect(() => new EventBuffer(0)).toThrow(RangeError);
    expect(() => new EventBuffer(-1)).toThrow(RangeError);
  });

  test("rejects a non-positive maxBytes", () => {
    expect(() => new EventBuffer(10, 0)).toThrow(RangeError);
    expect(() => new EventBuffer(10, -1)).toThrow(RangeError);
  });

  test("defaults to a 10MB byte bound when unspecified", () => {
    const buf = new EventBuffer(10_000);
    // Comfortably under the 10MB default: no eviction from the byte bound alone.
    for (let i = 0; i < 100; i++) buf.push(evtWithChunk(String(i), "x".repeat(1000)));
    expect(buf.size).toBe(100);
  });

  test("evicts the oldest event(s) once the byte bound is exceeded, even under the count cap", () => {
    const bigChunk = "x".repeat(100);
    const perEventSize = JSON.stringify(evtWithChunk("0", bigChunk)).length;
    // maxBytes fits a bit more than 2 events but fewer than 3.
    const buf = new EventBuffer(100, Math.floor(perEventSize * 2.5));
    buf.push(evtWithChunk("1", bigChunk));
    buf.push(evtWithChunk("2", bigChunk));
    expect(buf.size).toBe(2);
    buf.push(evtWithChunk("3", bigChunk));
    // Adding a 3rd event exceeds the byte bound, so the oldest ("1") is evicted even though
    // the count cap (100) was nowhere near hit.
    expect(buf.size).toBe(2);
    expect(buf.getEventsAfter(undefined).events.map((e) => e.id)).toEqual(["2", "3"]);
  });

  test("keeps at least one event even if it alone exceeds maxBytes", () => {
    const buf = new EventBuffer(100, 10);
    const huge = evtWithChunk("1", "y".repeat(1000));
    buf.push(huge);
    expect(buf.size).toBe(1);
    expect(buf.getEventsAfter(undefined)).toEqual({ events: [huge], gap: false });

    const huge2 = evtWithChunk("2", "z".repeat(1000));
    buf.push(huge2);
    // The single oldest oversized event is evicted to make room for the new single event —
    // never left completely empty.
    expect(buf.size).toBe(1);
    expect(buf.getEventsAfter(undefined)).toEqual({ events: [huge2], gap: false });
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
