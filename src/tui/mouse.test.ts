import { describe, expect, test } from "bun:test";
import {
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  parseSgrMouse,
  parseSgrMouseChunk,
  stripSgrMouseSequences,
} from "./mouse.ts";

const ESC = "\x1b";

describe("parseSgrMouse", () => {
  test("parses a scroll-up wheel report (Cb=64)", () => {
    const evt = parseSgrMouse(`${ESC}[<64;10;5M`);
    expect(evt).toEqual({
      type: "scrollUp",
      button: 0,
      x: 10,
      y: 5,
      shift: false,
      meta: false,
      ctrl: false,
    });
  });

  test("parses a scroll-down wheel report (Cb=65)", () => {
    const evt = parseSgrMouse(`${ESC}[<65;10;5M`);
    expect(evt?.type).toBe("scrollDown");
  });

  test("parses a left-button press", () => {
    const evt = parseSgrMouse(`${ESC}[<0;1;1M`);
    expect(evt).toEqual({
      type: "down",
      button: 0,
      x: 1,
      y: 1,
      shift: false,
      meta: false,
      ctrl: false,
    });
  });

  test("parses a release (lowercase m final byte)", () => {
    const evt = parseSgrMouse(`${ESC}[<0;1;1m`);
    expect(evt?.type).toBe("up");
  });

  test("parses drag (motion bit + button held)", () => {
    const evt = parseSgrMouse(`${ESC}[<32;1;1M`);
    expect(evt?.type).toBe("drag");
  });

  test("parses move (motion bit, no button held)", () => {
    const evt = parseSgrMouse(`${ESC}[<35;1;1M`);
    expect(evt?.type).toBe("move");
  });

  test("decodes shift/meta/ctrl modifier bits", () => {
    // button 0 (left) + shift(4) + meta(8) + ctrl(16) = 28
    const evt = parseSgrMouse(`${ESC}[<28;1;1M`);
    expect(evt).toEqual({
      type: "down",
      button: 0,
      x: 1,
      y: 1,
      shift: true,
      meta: true,
      ctrl: true,
    });
  });

  test("returns null for non-matching input", () => {
    expect(parseSgrMouse("hello")).toBeNull();
    expect(parseSgrMouse(`${ESC}[<1;2M`)).toBeNull();
  });
});

describe("parseSgrMouseChunk", () => {
  test("extracts multiple coalesced reports from one read", () => {
    const chunk = `${ESC}[<64;10;5M${ESC}[<65;10;6M`;
    const events = parseSgrMouseChunk(chunk);
    expect(events.map((e) => e.type)).toEqual(["scrollUp", "scrollDown"]);
  });

  test("ignores non-mouse bytes interleaved with reports", () => {
    const chunk = `abc${ESC}[<64;10;5Mdef`;
    const events = parseSgrMouseChunk(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("scrollUp");
  });

  test("returns empty array when there are no mouse reports", () => {
    expect(parseSgrMouseChunk("just some text")).toEqual([]);
  });
});

describe("stripSgrMouseSequences", () => {
  test("removes a complete sequence, leaving surrounding text intact", () => {
    expect(stripSgrMouseSequences(`abc${ESC}[<64;10;5Mdef`)).toBe("abcdef");
  });

  test("removes multiple coalesced sequences", () => {
    expect(stripSgrMouseSequences(`${ESC}[<64;10;5M${ESC}[<65;10;6M`)).toBe("");
  });

  test("removes a trailing incomplete sequence (chunk split mid-report)", () => {
    expect(stripSgrMouseSequences(`hello${ESC}[<64;10;`)).toBe("hello");
  });

  test("leaves ordinary text and unrelated escape sequences untouched", () => {
    expect(stripSgrMouseSequences("hello world")).toBe("hello world");
    expect(stripSgrMouseSequences(`${ESC}[A`)).toBe(`${ESC}[A`);
  });

  test("regression: this is the exact garbage-into-composer bug — a raw wheel report is fully stripped, not partially consumed", () => {
    // Before DH-0126, parseKeys' unrecognized-CSI fallback only consumed the first 3 bytes
    // (`ESC [ <`) and then read the remaining digits/semicolons back out as literal
    // keystrokes. Stripping the whole sequence here is what prevents that.
    const raw = `${ESC}[<0;60;24M`;
    expect(stripSgrMouseSequences(raw)).toBe("");
  });
});

describe("protocol strings", () => {
  test("MOUSE_ENABLE turns on click + button-motion + SGR extended coordinates", () => {
    expect(MOUSE_ENABLE).toBe("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
  });

  test("MOUSE_DISABLE turns off every mode this module or another tool might have set", () => {
    expect(MOUSE_DISABLE).toBe("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l");
  });
});
