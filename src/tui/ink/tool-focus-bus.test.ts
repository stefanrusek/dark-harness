import { describe, expect, test } from "bun:test";
import { createToolFocusBus } from "./tool-focus-bus.ts";

describe("createToolFocusBus", () => {
  test("delivers an emitted event to a subscribed listener", () => {
    const bus = createToolFocusBus();
    const received: string[] = [];
    bus.subscribe((event) => received.push(event));
    bus.emit("up");
    bus.emit("down");
    bus.emit("activate");
    expect(received).toEqual(["up", "down", "activate"]);
  });

  test("delivers to multiple subscribers", () => {
    const bus = createToolFocusBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((event) => a.push(event));
    bus.subscribe((event) => b.push(event));
    bus.emit("activate");
    expect(a).toEqual(["activate"]);
    expect(b).toEqual(["activate"]);
  });

  test("unsubscribe stops further delivery", () => {
    const bus = createToolFocusBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));
    bus.emit("up");
    unsubscribe();
    bus.emit("down");
    expect(received).toEqual(["up"]);
  });

  test("emit with no subscribers is a no-op", () => {
    const bus = createToolFocusBus();
    expect(() => bus.emit("up")).not.toThrow();
  });
});
