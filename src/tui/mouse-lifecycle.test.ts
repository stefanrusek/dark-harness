import { describe, expect, test } from "bun:test";
import { MouseLifecycle } from "./mouse-lifecycle.ts";
import { MOUSE_DISABLE, MOUSE_ENABLE } from "./mouse.ts";

describe("MouseLifecycle", () => {
  test("enable() writes the enable sequence once", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.enable();
    expect(writes).toEqual([MOUSE_ENABLE]);
  });

  test("enable() is idempotent — a second call writes nothing more", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.enable();
    lifecycle.enable();
    expect(writes).toEqual([MOUSE_ENABLE]);
  });

  test("tearDown() writes the disable sequence", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.enable();
    lifecycle.tearDown();
    expect(writes).toEqual([MOUSE_ENABLE, MOUSE_DISABLE]);
  });

  test("tearDown() is idempotent — a second call writes nothing more", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.enable();
    lifecycle.tearDown();
    lifecycle.tearDown();
    expect(writes).toEqual([MOUSE_ENABLE, MOUSE_DISABLE]);
  });

  test("tearDown() before enable() still writes the disable sequence (belt-and-braces cleanup)", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.tearDown();
    expect(writes).toEqual([MOUSE_DISABLE]);
  });

  test("enable() after tearDown() re-enables", () => {
    const writes: string[] = [];
    const lifecycle = new MouseLifecycle((s) => writes.push(s));
    lifecycle.enable();
    lifecycle.tearDown();
    lifecycle.enable();
    expect(writes).toEqual([MOUSE_ENABLE, MOUSE_DISABLE, MOUSE_ENABLE]);
  });
});
