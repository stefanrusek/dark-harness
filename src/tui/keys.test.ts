import { describe, expect, test } from "bun:test";
import { parseKeys } from "./keys.ts";

describe("parseKeys", () => {
  test("parses printable characters", () => {
    expect(parseKeys("ab")).toEqual([
      { kind: "char", value: "a" },
      { kind: "char", value: "b" },
    ]);
  });

  test("parses enter from \\r and \\n", () => {
    expect(parseKeys("\r")).toEqual([{ kind: "enter" }]);
    expect(parseKeys("\n")).toEqual([{ kind: "enter" }]);
  });

  test("parses backspace from DEL and BS", () => {
    expect(parseKeys("\x7f")).toEqual([{ kind: "backspace" }]);
    expect(parseKeys("\b")).toEqual([{ kind: "backspace" }]);
  });

  test("parses ctrl-c", () => {
    expect(parseKeys("\x03")).toEqual([{ kind: "ctrl_c" }]);
  });

  test("parses tab", () => {
    expect(parseKeys("\t")).toEqual([{ kind: "tab" }]);
  });

  test("parses arrow keys via CSI sequences", () => {
    expect(parseKeys("\x1b[A")).toEqual([{ kind: "up" }]);
    expect(parseKeys("\x1b[B")).toEqual([{ kind: "down" }]);
    expect(parseKeys("\x1b[C")).toEqual([{ kind: "right" }]);
    expect(parseKeys("\x1b[D")).toEqual([{ kind: "left" }]);
  });

  test("parses Home/End via bare CSI letters", () => {
    expect(parseKeys("\x1b[H")).toEqual([{ kind: "home" }]);
    expect(parseKeys("\x1b[F")).toEqual([{ kind: "end" }]);
  });

  test("parses Home/End/Delete via numeric CSI ~ sequences", () => {
    expect(parseKeys("\x1b[1~")).toEqual([{ kind: "home" }]);
    expect(parseKeys("\x1b[7~")).toEqual([{ kind: "home" }]);
    expect(parseKeys("\x1b[4~")).toEqual([{ kind: "end" }]);
    expect(parseKeys("\x1b[8~")).toEqual([{ kind: "end" }]);
    expect(parseKeys("\x1b[3~")).toEqual([{ kind: "delete" }]);
  });

  test("reports an unrecognized numeric CSI ~ sequence as unknown (params consumed, trailing ~ as a char)", () => {
    expect(parseKeys("\x1b[9~")).toEqual([
      { kind: "unknown", raw: "\x1b[9" },
      { kind: "char", value: "~" },
    ]);
  });

  test("parses a bracketed paste as one paste event carrying the literal text", () => {
    expect(parseKeys("\x1b[200~hello\nworld\x1b[201~")).toEqual([
      { kind: "paste", text: "hello\nworld" },
    ]);
  });

  test("a bracketed paste's contents are never re-parsed as enter/char keystrokes", () => {
    // Without bracketed-paste handling, the embedded \r would otherwise parse as `enter`,
    // fragmenting the paste into multiple sends (the DH-0026 bug).
    const events = parseKeys("\x1b[200~line one\rline two\x1b[201~");
    expect(events).toEqual([{ kind: "paste", text: "line one\rline two" }]);
  });

  test("a paste mixed with ordinary typing before and after parses in order", () => {
    expect(parseKeys("ab\x1b[200~pasted\x1b[201~cd")).toEqual([
      { kind: "char", value: "a" },
      { kind: "char", value: "b" },
      { kind: "paste", text: "pasted" },
      { kind: "char", value: "c" },
      { kind: "char", value: "d" },
    ]);
  });

  test("a paste missing its closing marker is a best-effort paste of what's present", () => {
    expect(parseKeys("\x1b[200~no closing marker yet")).toEqual([
      { kind: "paste", text: "no closing marker yet" },
    ]);
  });

  test("parses a lone escape as escape", () => {
    expect(parseKeys("\x1b")).toEqual([{ kind: "escape" }]);
  });

  test("reports an unrecognized CSI letter as unknown", () => {
    expect(parseKeys("\x1b[Z")).toEqual([{ kind: "unknown", raw: "\x1b[Z" }]);
  });

  test("reports an incomplete CSI sequence as unknown", () => {
    expect(parseKeys("\x1b[")).toEqual([{ kind: "unknown", raw: "\x1b[" }]);
  });

  test("reports escape followed by a non-CSI byte as unknown", () => {
    expect(parseKeys("\x1bx")).toEqual([{ kind: "unknown", raw: "\x1bx" }]);
  });

  test("reports other control bytes as unknown", () => {
    expect(parseKeys("\x01")).toEqual([{ kind: "unknown", raw: JSON.stringify("\x01") }]);
  });

  test("parses a mixed chunk into multiple events in order", () => {
    expect(parseKeys("hi\x1b[Athere\r")).toEqual([
      { kind: "char", value: "h" },
      { kind: "char", value: "i" },
      { kind: "up" },
      { kind: "char", value: "t" },
      { kind: "char", value: "h" },
      { kind: "char", value: "e" },
      { kind: "char", value: "r" },
      { kind: "char", value: "e" },
      { kind: "enter" },
    ]);
  });

  test("empty input yields no events", () => {
    expect(parseKeys("")).toEqual([]);
  });
});
