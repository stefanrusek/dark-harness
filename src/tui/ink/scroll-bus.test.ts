import { describe, expect, test } from "bun:test";
import { createScrollBus } from "./scroll-bus.ts";

describe("createScrollBus", () => {
  test("delivers an emitted delta to a subscribed listener", () => {
    const bus = createScrollBus();
    const received: number[] = [];
    bus.subscribe((delta) => received.push(delta));
    bus.emit(3);
    expect(received).toEqual([3]);
  });

  test("delivers to multiple subscribers", () => {
    const bus = createScrollBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe((delta) => a.push(delta));
    bus.subscribe((delta) => b.push(delta));
    bus.emit(-3);
    expect(a).toEqual([-3]);
    expect(b).toEqual([-3]);
  });

  test("unsubscribe stops further delivery", () => {
    const bus = createScrollBus();
    const received: number[] = [];
    const unsubscribe = bus.subscribe((delta) => received.push(delta));
    bus.emit(3);
    unsubscribe();
    bus.emit(3);
    expect(received).toEqual([3]);
  });

  test("emit with no subscribers is a no-op", () => {
    const bus = createScrollBus();
    expect(() => bus.emit(3)).not.toThrow();
  });

  test("two independent buses don't share listeners", () => {
    const busA = createScrollBus();
    const busB = createScrollBus();
    const received: number[] = [];
    busA.subscribe((delta) => received.push(delta));
    busB.emit(5);
    expect(received).toEqual([]);
  });
});
