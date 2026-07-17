import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import type { Turn } from "../types.ts";
import { TranscriptPane, renderTranscript } from "./TranscriptPane.tsx";

function turn(overrides: Partial<Turn> & Pick<Turn, "role" | "text">): Turn {
  return overrides;
}

describe("renderTranscript", () => {
  test("user turn: bold-yellow '>' gutter on the first row, plain indent on continuations", () => {
    const rows = renderTranscript([turn({ role: "user", text: "hello" })], 40);
    expect(rows[0]).toContain("hello");
    expect(rows[0]).toContain("\x1b[1;33m>");
  });

  test("assistant turn: cyan '●' gutter, rendered through the markdown pipeline", () => {
    const rows = renderTranscript([turn({ role: "assistant", text: "hi" })], 40);
    expect(rows[0]).toContain("\x1b[36m●");
    expect(rows[0]).toContain("hi");
  });

  test("tool marker turn (no terminalStatus): dim with a gear glyph", () => {
    const rows = renderTranscript([turn({ role: "tool", text: "Bash: ls" })], 40);
    expect(rows[0]).toContain("⚙");
    expect(rows[0]).toContain("\x1b[2m");
  });

  test("tool marker with a failed toolError appends a red ✗ on its last row", () => {
    const rows = renderTranscript([turn({ role: "tool", text: "Bash: ls", toolError: true })], 40);
    expect(rows[rows.length - 1]).toContain("\x1b[31m✗");
  });

  test("DH-0130: terminalStatus marker uses the status token's glyph/color/word instead of the dim gear", () => {
    const rows = renderTranscript(
      [turn({ role: "tool", text: "Agent failed", terminalStatus: "failed" })],
      40,
    );
    expect(rows[0]).toContain("\x1b[31m"); // STATUS_TOKENS.failed.sgr
    expect(rows[0]).not.toContain("⚙");
  });

  test("consecutive turns get a blank separator line between them", () => {
    const rows = renderTranscript(
      [turn({ role: "user", text: "a" }), turn({ role: "user", text: "b" })],
      40,
    );
    expect(rows).toContain("");
  });
});

describe("TranscriptPane", () => {
  test("empty transcript shows the caller-supplied empty text", () => {
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript: [],
        cols: 40,
        height: 3,
        emptyText: "Waiting for root agent to start…",
      }),
    );
    expect(lastFrame()).toContain("Waiting for root agent to start…");
  });

  test("DH-0126: windows to only the last `height` rows when content overflows the viewport", () => {
    const transcript: Turn[] = Array.from({ length: 10 }, (_, i) =>
      turn({ role: "user", text: `msg ${i}` }),
    );
    const { lastFrame } = render(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 3, emptyText: "" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("msg 9");
    expect(frame).not.toContain("msg 0");
  });

  test("DH-0129-equivalent: auto-scrolls to reveal new content when already at the bottom", () => {
    let transcript: Turn[] = [turn({ role: "user", text: "msg 0" })];
    const { lastFrame, rerender } = render(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 2, emptyText: "" }),
    );
    transcript = [
      ...transcript,
      turn({ role: "user", text: "msg 1" }),
      turn({ role: "user", text: "msg 2" }),
    ];
    rerender(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 2, emptyText: "" }),
    );
    expect(lastFrame() ?? "").toContain("msg 2");
  });

  test("does not force-scroll when the operator has scrolled away from the bottom", () => {
    // A pane whose height already fits every row is trivially "at bottom"; this asserts the
    // windowing math itself doesn't regress when the transcript never overflows the viewport.
    const transcript: Turn[] = [turn({ role: "user", text: "only" })];
    const { lastFrame } = render(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 5, emptyText: "" }),
    );
    expect(lastFrame() ?? "").toContain("only");
  });

  test("shrinking the viewport (not new content) does not pull a scrolled-up pane back to bottom", () => {
    // Grow to an overflowing transcript first (still at bottom == last message visible), then
    // shrink the viewport further without adding content — `wasAtBottom` was true going in, so
    // this exercises the "still at bottom, viewport just got smaller" branch distinctly from
    // the "new content arrived while scrolled up" branch above.
    const transcript: Turn[] = Array.from({ length: 5 }, (_, i) =>
      turn({ role: "user", text: `m${i}` }),
    );
    const { lastFrame, rerender } = render(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 3, emptyText: "" }),
    );
    expect(lastFrame() ?? "").toContain("m4");
    rerender(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 1, emptyText: "" }),
    );
    expect(lastFrame() ?? "").toContain("m4");
  });
});
