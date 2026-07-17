import { describe, expect, test } from "bun:test";
import {
  atBottom,
  clampOffset,
  maxOffset,
  scrollBy,
  toBottom,
  toTop,
  visibleSlice,
} from "./scroll-viewport.ts";

describe("maxOffset", () => {
  test("zero when content fits the viewport", () => {
    expect(maxOffset(5, 10)).toBe(0);
  });
  test("totalLines - viewportHeight when content overflows", () => {
    expect(maxOffset(20, 10)).toBe(10);
  });
  test("non-positive viewport: every row counts as below the fold", () => {
    expect(maxOffset(20, 0)).toBe(20);
    expect(maxOffset(20, -1)).toBe(20);
  });
});

describe("clampOffset", () => {
  test("clamps negative offsets to 0", () => {
    expect(clampOffset(-5, 20, 10)).toBe(0);
  });
  test("clamps offsets above max down to max", () => {
    expect(clampOffset(999, 20, 10)).toBe(10);
  });
  test("passes through an in-range offset unchanged", () => {
    expect(clampOffset(3, 20, 10)).toBe(3);
  });
});

describe("visibleSlice", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  test("returns the windowed slice at a given offset", () => {
    expect(visibleSlice(lines, 5, 3)).toEqual(["line 5", "line 6", "line 7"]);
  });
  test("clamps an out-of-range offset before slicing", () => {
    expect(visibleSlice(lines, 999, 3)).toEqual(["line 17", "line 18", "line 19"]);
  });
  test("non-positive viewport height yields no rows", () => {
    expect(visibleSlice(lines, 0, 0)).toEqual([]);
  });
});

describe("scrollBy", () => {
  test("moves the offset by delta, clamped", () => {
    expect(scrollBy({ offset: 5 }, 3, 20, 10)).toEqual({ offset: 8 });
    expect(scrollBy({ offset: 5 }, -100, 20, 10)).toEqual({ offset: 0 });
    expect(scrollBy({ offset: 5 }, 100, 20, 10)).toEqual({ offset: 10 });
  });
});

describe("toTop / toBottom", () => {
  test("toTop is always offset 0", () => {
    expect(toTop()).toEqual({ offset: 0 });
  });
  test("toBottom is maxOffset", () => {
    expect(toBottom(20, 10)).toEqual({ offset: 10 });
  });
});

describe("atBottom", () => {
  test("true when the clamped offset equals maxOffset", () => {
    expect(atBottom(10, 20, 10)).toBe(true);
    expect(atBottom(999, 20, 10)).toBe(true);
  });
  test("false when scrolled away from the bottom", () => {
    expect(atBottom(0, 20, 10)).toBe(false);
  });
});
