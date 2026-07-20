import { describe, expect, test } from "bun:test";
import {
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  MouseChunkAssembler,
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

describe("MouseChunkAssembler (DH-0230)", () => {
  test("reassembles a sequence split across two stdin chunks", () => {
    const assembler = new MouseChunkAssembler();
    // A rapid scroll notch's escape sequence, split mid-report — exactly what a PTY read
    // buffer can do under aggressive/high-velocity scrolling.
    const first = assembler.process(`${ESC}[<64;10;`);
    expect(first.events).toEqual([]);
    expect(first.rest).toBe("");

    const second = assembler.process("5M");
    expect(second.events.map((e) => e.type)).toEqual(["scrollUp"]);
    expect(second.rest).toBe("");
  });

  test("does not leak the second chunk's continuation fragment as literal text", () => {
    // Before the fix: `;20M` (missing its ESC[< prefix, now living in its own chunk) had no
    // way to be recognized as a mouse continuation, and fell straight through to parseKeys as
    // garbage keystrokes. This is DH-0230's actual reported symptom.
    const assembler = new MouseChunkAssembler();
    assembler.process(`${ESC}[<65;10;`);
    const second = assembler.process("20M");
    expect(second.rest).toBe("");
    expect(second.events.map((e) => e.type)).toEqual(["scrollDown"]);
  });

  test("does not buffer a bare trailing ESC as a mouse partial (would delay a real Escape keypress)", () => {
    // A standalone Escape key is a legitimate one-byte `data` chunk on a real PTY. Treating a
    // trailing ESC as "might be a mouse sequence in progress" would delay dispatching it until
    // whatever arrives next — a real regression caught by the e2e PTY suite. The assembler only
    // buffers once the full `ESC[<` introducer is present.
    const assembler = new MouseChunkAssembler();
    const first = assembler.process(ESC);
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(ESC);

    // Confirms nothing was carried: the next chunk parses independently.
    const second = assembler.process("q");
    expect(second.events).toEqual([]);
    expect(second.rest).toBe("q");
  });

  test("still buffers correctly when the split lands right after the introducer", () => {
    const assembler = new MouseChunkAssembler();
    const first = assembler.process(`${ESC}[<`);
    expect(first.events).toEqual([]);
    expect(first.rest).toBe("");
    const second = assembler.process("64;1;1M");
    expect(second.events.map((e) => e.type)).toEqual(["scrollUp"]);
    expect(second.rest).toBe("");
  });

  test("a burst of many rapid, unsplit notches across separate chunks all parse cleanly", () => {
    const assembler = new MouseChunkAssembler();
    const notches: string[] = [];
    for (let i = 0; i < 50; i++) {
      const { events, rest } = assembler.process(`${ESC}[<64;10;${5 + i}M`);
      expect(rest).toBe("");
      notches.push(...events.map((e) => e.type));
    }
    expect(notches).toHaveLength(50);
    expect(notches.every((t) => t === "scrollUp")).toBe(true);
  });

  test("surrounding non-mouse text on either side of a split sequence survives untouched", () => {
    const assembler = new MouseChunkAssembler();
    const first = assembler.process(`abc${ESC}[<64;10;`);
    expect(first.rest).toBe("abc");
    const second = assembler.process("5Mdef");
    expect(second.rest).toBe("def");
    expect(second.events.map((e) => e.type)).toEqual(["scrollUp"]);
  });

  test("abandons an implausibly long carry instead of buffering ordinary text forever", () => {
    const assembler = new MouseChunkAssembler();
    // Looks like the start of a mouse introducer but never resolves within a sane sequence
    // length — must not be held onto indefinitely as a "partial".
    const long = `${ESC}[<${"1".repeat(40)}`;
    const first = assembler.process(long);
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(long);

    // Confirms the carry was cleared: the next chunk is parsed independently, not glued to
    // the abandoned garbage.
    const second = assembler.process(`${ESC}[<64;1;1M`);
    expect(second.events.map((e) => e.type)).toEqual(["scrollUp"]);
    expect(second.rest).toBe("");
  });

  test("multiple complete reports plus a trailing split report in one burst", () => {
    const assembler = new MouseChunkAssembler();
    const first = assembler.process(`${ESC}[<64;1;1M${ESC}[<65;2;2M${ESC}[<64;3;`);
    expect(first.events.map((e) => e.type)).toEqual(["scrollUp", "scrollDown"]);
    expect(first.rest).toBe("");

    const second = assembler.process("3M");
    expect(second.events.map((e) => e.type)).toEqual(["scrollUp"]);
    expect(second.rest).toBe("");
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
