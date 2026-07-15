// Pure key-parsing: raw stdin text -> logical KeyEvents. No terminal I/O here, so this is
// fully unit-testable; only the raw-mode stdin wiring in app.ts is untestable outside a PTY.

export type KeyEvent =
  | { kind: "char"; value: string }
  | { kind: "enter" }
  | { kind: "backspace" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "escape" }
  | { kind: "ctrl_c" }
  | { kind: "tab" }
  | { kind: "unknown"; raw: string };

const ARROW_BY_LETTER: Record<string, KeyEvent> = {
  A: { kind: "up" },
  B: { kind: "down" },
  C: { kind: "right" },
  D: { kind: "left" },
};

/**
 * Parse a chunk of raw stdin text (already decoded as utf8) into zero or more logical key
 * events. Handles common single-byte controls and `\x1b[<letter>` CSI arrow sequences.
 * Multi-byte sequences split across chunk boundaries (rare for interactive typing) are not
 * reassembled — an incomplete trailing escape sequence is reported as `unknown`.
 */
export function parseKeys(input: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\x1b") {
      const next = input[i + 1];
      if (next === "[") {
        const letter = input[i + 2];
        if (letter !== undefined && letter in ARROW_BY_LETTER) {
          const key = ARROW_BY_LETTER[letter];
          if (key) events.push(key);
          i += 3;
          continue;
        }
        // Unrecognized or incomplete CSI sequence: consume what we have.
        const raw = input.slice(i, i + 3);
        events.push({ kind: "unknown", raw });
        i += raw.length;
        continue;
      }
      if (next === undefined) {
        events.push({ kind: "escape" });
        i += 1;
        continue;
      }
      events.push({ kind: "unknown", raw: input.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      events.push({ kind: "enter" });
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      events.push({ kind: "backspace" });
      i += 1;
      continue;
    }
    if (ch === "\x03") {
      events.push({ kind: "ctrl_c" });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      events.push({ kind: "tab" });
      i += 1;
      continue;
    }
    if (ch !== undefined && ch >= " ") {
      events.push({ kind: "char", value: ch });
      i += 1;
      continue;
    }
    // Other control bytes: report as unknown rather than silently dropping.
    events.push({ kind: "unknown", raw: JSON.stringify(ch) });
    i += 1;
  }
  return events;
}
