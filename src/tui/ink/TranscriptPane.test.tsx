import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import type { Turn } from "../types.type.ts";
import { createScrollBus } from "./scroll-bus.ts";
import { buildFocusRows, renderTranscript, TranscriptPane } from "./TranscriptPane.tsx";
import { createToolFocusBus } from "./tool-focus-bus.ts";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

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
        emptyText: "Type a message below to get started.",
      }),
    );
    expect(lastFrame()).toContain("Type a message below to get started.");
  });

  test("DH-0124: multi-line empty text renders one row per '\\n'-separated line", () => {
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript: [],
        cols: 40,
        height: 3,
        emptyText: "[ dh ]\ndh 0.1.0 (abc123)",
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[ dh ]");
    expect(frame).toContain("dh 0.1.0 (abc123)");
  });

  test("DH-0214: a precomposed accented char followed by an extra combining mark doesn't drop the next character through Ink's real render path", () => {
    // "café" (precomposed é) + a literal U+0301 combining acute accent stacked on top of it —
    // two accents effectively on the same "e". Ink's own Output.get() grid-placement layer
    // (node_modules/ink/build/output.js, via @alcalzone/ansi-tokenize) gives that extra
    // combining mark its own one-column grid cell, unlike src/tui/width.ts's correct 0-column
    // model — every character after it drifts one column right and the trailing "." fell off
    // the row before the fix. This exercises Ink's real layout/render (ink-testing-library),
    // not just renderTranscript's string output, since the drop happens downstream of it.
    const doubleAccented = `caf${"é"}́ done.`; // café + combining acute (U+0301) + " done."
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript: [turn({ role: "user", text: doubleAccented })],
        cols: 40,
        height: 3,
        emptyText: "",
      }),
    );
    expect(lastFrame() ?? "").toContain("done.");
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

  test("DH-0126: a negative scrollBus delta scrolls up, revealing earlier content", async () => {
    const transcript: Turn[] = Array.from({ length: 10 }, (_, i) =>
      turn({ role: "user", text: `msg ${i}` }),
    );
    const scrollBus = createScrollBus();
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript,
        cols: 40,
        height: 3,
        emptyText: "",
        scrollBus,
      }),
    );
    expect(lastFrame() ?? "").toContain("msg 9");
    await flush();
    scrollBus.emit(-10);
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("msg 9");
    expect(frame).toContain("msg 4");
  });

  test("DH-0126: scrolling up then back down returns to the bottom (clamped, not runaway)", async () => {
    const transcript: Turn[] = Array.from({ length: 10 }, (_, i) =>
      turn({ role: "user", text: `msg ${i}` }),
    );
    const scrollBus = createScrollBus();
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript,
        cols: 40,
        height: 3,
        emptyText: "",
        scrollBus,
      }),
    );
    await flush();
    scrollBus.emit(-3);
    await flush();
    scrollBus.emit(30);
    await flush();
    expect(lastFrame() ?? "").toContain("msg 9");
  });

  test("DH-0245: headerLines are prepended even when the transcript is empty", () => {
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript: [],
        cols: 40,
        height: 5,
        emptyText: "Type a message below to get started.",
        headerLines: ["[ dh banner ]"],
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[ dh banner ]");
    expect(frame).toContain("Type a message below to get started.");
  });

  test("DH-0245 User Story 2: headerLines persist once the first turn is sent — still present in the render tree immediately after", () => {
    let transcript: Turn[] = [];
    const { lastFrame, rerender } = render(
      React.createElement(TranscriptPane, {
        transcript,
        cols: 40,
        height: 5,
        emptyText: "Type a message below to get started.",
        headerLines: ["[ dh banner ]"],
      }),
    );
    expect(lastFrame() ?? "").toContain("[ dh banner ]");
    transcript = [turn({ role: "user", text: "first message" })];
    rerender(
      React.createElement(TranscriptPane, {
        transcript,
        cols: 40,
        height: 5,
        emptyText: "Type a message below to get started.",
        headerLines: ["[ dh banner ]"],
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[ dh banner ]");
    expect(frame).toContain("first message");
  });

  test("DH-0245 User Story 3: scrolling to the very top reveals headerLines again", async () => {
    const transcript: Turn[] = Array.from({ length: 20 }, (_, i) =>
      turn({ role: "user", text: `msg ${i}` }),
    );
    const scrollBus = createScrollBus();
    const { lastFrame } = render(
      React.createElement(TranscriptPane, {
        transcript,
        cols: 40,
        height: 3,
        emptyText: "",
        headerLines: ["[ dh banner ]"],
        scrollBus,
      }),
    );
    // At the bottom (default), the banner (top of the pane's row list) is scrolled out of view.
    expect(lastFrame() ?? "").not.toContain("[ dh banner ]");
    await flush();
    scrollBus.emit(-1000); // far more than needed — scrollBy clamps to the top.
    await flush();
    expect(lastFrame() ?? "").toContain("[ dh banner ]");
  });

  test("without a scrollBus prop, emitting on an unrelated bus has no effect (no crash, offset unchanged)", () => {
    const transcript: Turn[] = Array.from({ length: 10 }, (_, i) =>
      turn({ role: "user", text: `msg ${i}` }),
    );
    const { lastFrame } = render(
      React.createElement(TranscriptPane, { transcript, cols: 40, height: 3, emptyText: "" }),
    );
    expect(lastFrame() ?? "").toContain("msg 9");
  });
});

describe("DH-0246: consecutive tool-call grouping", () => {
  describe("buildFocusRows", () => {
    test("a run of 2+ consecutive tool turns is one focusable group row", () => {
      const transcript = [
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "tool", text: "Bash: b" }),
      ];
      const rows = buildFocusRows(transcript, new Set());
      expect(rows).toEqual([{ kind: "group", startIndex: 0, turns: transcript }]);
    });

    test("a lone tool call is its own focusable row, not wrapped in a group", () => {
      const transcript = [
        turn({ role: "user", text: "hi" }),
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "assistant", text: "ok" }),
      ];
      const rows = buildFocusRows(transcript, new Set());
      expect(rows).toEqual([{ kind: "tool", index: 1, turn: transcript[1] as Turn }]);
    });

    test("a terminal-status marker breaks a run into two separate groups", () => {
      const transcript = [
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "tool", text: "Bash: b" }),
        turn({ role: "tool", text: "Agent done", terminalStatus: "done" }),
        turn({ role: "tool", text: "Bash: c" }),
        turn({ role: "tool", text: "Bash: d" }),
      ];
      const rows = buildFocusRows(transcript, new Set());
      expect(rows).toEqual([
        { kind: "group", startIndex: 0, turns: transcript.slice(0, 2) },
        { kind: "group", startIndex: 3, turns: transcript.slice(3, 5) },
      ]);
    });

    test("an expanded group additionally contributes one focusable row per member, right after its header", () => {
      const transcript = [
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "tool", text: "Bash: b" }),
      ];
      const rows = buildFocusRows(transcript, new Set([0]));
      expect(rows).toEqual([
        { kind: "group", startIndex: 0, turns: transcript },
        { kind: "tool", index: 0, turn: transcript[0] as Turn },
        { kind: "tool", index: 1, turn: transcript[1] as Turn },
      ]);
    });
  });

  describe("renderTranscript grouping/detail", () => {
    test("a run of 2+ tool calls renders as one collapsed 'N tool calls' row, not N lines", () => {
      const rows = renderTranscript(
        [turn({ role: "tool", text: "Bash: a" }), turn({ role: "tool", text: "Bash: b" })],
        40,
      );
      expect(rows.join("\n")).toContain("2 tool calls");
      expect(rows.join("\n")).not.toContain("Bash: a");
    });

    test("a failed call inside a group is reflected in the collapsed summary's failed count", () => {
      const rows = renderTranscript(
        [
          turn({ role: "tool", text: "Bash: a", toolError: true }),
          turn({ role: "tool", text: "Bash: b" }),
        ],
        40,
      );
      expect(rows.join("\n")).toContain("2 tool calls (1 failed)");
    });

    test("expanding a group (via focus state) reveals each member's own row", () => {
      const rows = renderTranscript(
        [turn({ role: "tool", text: "Bash: a" }), turn({ role: "tool", text: "Bash: b" })],
        40,
        { focusIndex: -1, expandedGroups: new Set([0]), expandedTools: new Set() },
      );
      const text = rows.join("\n");
      expect(text).toContain("Bash: a");
      expect(text).toContain("Bash: b");
    });

    test("the focused row (by index into the flattened focus-row list) gets the '> ' marker", () => {
      const rows = renderTranscript([turn({ role: "tool", text: "Bash: a" })], 40, {
        focusIndex: 0,
        expandedGroups: new Set(),
        expandedTools: new Set(),
      });
      expect(rows.join("\n")).toContain("> Bash: a");
    });

    test("detail expansion shows input summary and 'pending…' before the tool_result resolves", () => {
      const rows = renderTranscript([turn({ role: "tool", text: "Bash: a" })], 40, {
        focusIndex: -1,
        expandedGroups: new Set(),
        expandedTools: new Set([0]),
      });
      const text = rows.join("\n");
      expect(text).toContain("Input: Bash: a");
      expect(text).toContain("Result: pending…");
    });

    test("detail expansion shows success + duration once the tool_result resolves", () => {
      const rows = renderTranscript([turn({ role: "tool", text: "Bash: a", durationMs: 42 })], 40, {
        focusIndex: -1,
        expandedGroups: new Set(),
        expandedTools: new Set([0]),
      });
      expect(rows.join("\n")).toContain("Result: ✓ ok · 42ms");
    });

    test("detail expansion shows error + duration when the tool_result failed", () => {
      const rows = renderTranscript(
        [turn({ role: "tool", text: "Bash: a", toolError: true, durationMs: 9 })],
        40,
        { focusIndex: -1, expandedGroups: new Set(), expandedTools: new Set([0]) },
      );
      expect(rows.join("\n")).toContain("Result: ✗ error · 9ms");
    });
  });

  describe("TranscriptPane + toolFocusBus interaction", () => {
    test("activate toggles a standalone tool call's detail open and closed", async () => {
      const bus = createToolFocusBus();
      const transcript = [turn({ role: "tool", text: "Bash: a", durationMs: 5 })];
      const { lastFrame } = render(
        React.createElement(TranscriptPane, {
          transcript,
          cols: 40,
          height: 6,
          emptyText: "",
          toolFocusBus: bus,
        }),
      );
      await flush();
      expect(lastFrame() ?? "").not.toContain("Result:");

      bus.emit("activate");
      await flush();
      expect(lastFrame() ?? "").toContain("Result: ✓ ok · 5ms");

      bus.emit("activate");
      await flush();
      expect(lastFrame() ?? "").not.toContain("Result:");
    });

    test("activate on a focused group header expands it into member rows, and again re-collapses it", async () => {
      const bus = createToolFocusBus();
      const transcript = [
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "tool", text: "Bash: b" }),
      ];
      const { lastFrame } = render(
        React.createElement(TranscriptPane, {
          transcript,
          cols: 40,
          height: 6,
          emptyText: "",
          toolFocusBus: bus,
        }),
      );
      await flush();
      expect(lastFrame() ?? "").toContain("2 tool calls");
      expect(lastFrame() ?? "").not.toContain("Bash: a");

      bus.emit("activate");
      await flush();
      expect(lastFrame() ?? "").toContain("Bash: a");
      expect(lastFrame() ?? "").toContain("Bash: b");

      bus.emit("activate");
      await flush();
      expect(lastFrame() ?? "").not.toContain("Bash: a");
    });

    test("down/up move focus between two standalone tool calls separated by a user turn", async () => {
      const bus = createToolFocusBus();
      const transcript = [
        turn({ role: "tool", text: "Bash: a", durationMs: 1 }),
        turn({ role: "user", text: "hi" }),
        turn({ role: "tool", text: "Bash: b", durationMs: 2 }),
      ];
      const { lastFrame } = render(
        React.createElement(TranscriptPane, {
          transcript,
          cols: 40,
          height: 8,
          emptyText: "",
          toolFocusBus: bus,
        }),
      );
      await flush();
      expect(lastFrame() ?? "").toContain("> Bash: a");

      bus.emit("down");
      await flush();
      expect(lastFrame() ?? "").toContain("> Bash: b");

      bus.emit("up");
      await flush();
      expect(lastFrame() ?? "").toContain("> Bash: a");
    });

    test("focus recovers to the first tool row once one appears, after starting on an empty transcript", async () => {
      // Regression: an empty transcript has no focusable rows, so focus starts clamped to -1;
      // once a tool call actually appears, focus must snap back to row 0, not stay stuck at -1.
      const bus = createToolFocusBus();
      let transcript: Turn[] = [];
      const { lastFrame, rerender } = render(
        React.createElement(TranscriptPane, {
          transcript,
          cols: 40,
          height: 6,
          emptyText: "(empty)",
          toolFocusBus: bus,
        }),
      );
      await flush();
      transcript = [turn({ role: "tool", text: "Bash: a", durationMs: 3 })];
      rerender(
        React.createElement(TranscriptPane, {
          transcript,
          cols: 40,
          height: 6,
          emptyText: "(empty)",
          toolFocusBus: bus,
        }),
      );
      await flush();
      expect(lastFrame() ?? "").toContain("> Bash: a");

      bus.emit("activate");
      await flush();
      expect(lastFrame() ?? "").toContain("Result: ✓ ok · 3ms");
    });

    test("without a toolFocusBus prop, emitting on an unrelated bus has no effect (no crash)", async () => {
      const transcript = [
        turn({ role: "tool", text: "Bash: a" }),
        turn({ role: "tool", text: "Bash: b" }),
      ];
      const { lastFrame } = render(
        React.createElement(TranscriptPane, { transcript, cols: 40, height: 6, emptyText: "" }),
      );
      await flush();
      expect(lastFrame() ?? "").toContain("2 tool calls");
    });
  });
});
