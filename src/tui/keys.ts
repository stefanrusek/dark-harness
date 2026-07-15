// Pure key-parsing: raw stdin text -> logical KeyEvents. No terminal I/O here, so this is
// fully unit-testable; only the raw-mode stdin wiring in app.ts is untestable outside a PTY.

export type KeyEvent =
  | { kind: "char"; value: string }
  | { kind: "enter" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "escape" }
  | { kind: "ctrl_c" }
  | { kind: "tab" }
  /** Bracketed-paste payload (`\x1b[200~...\x1b[201~`), enabled by app.ts on startup. Carries
   * the literal pasted text verbatim (including any embedded newlines) so a multi-line paste
   * is applied to the input box as one edit rather than being re-parsed as individual `enter`
   * keystrokes that would fragment it into several sent messages (DH-0026). */
  | { kind: "paste"; text: string }
  | { kind: "unknown"; raw: string };

const ARROW_BY_LETTER: Record<string, KeyEvent> = {
  A: { kind: "up" },
  B: { kind: "down" },
  C: { kind: "right" },
  D: { kind: "left" },
  H: { kind: "home" },
  F: { kind: "end" },
};

/** `CSI <params> ~` terminated sequences keyed by their numeric parameter — the other common
 * encoding (alongside bare `CSI <letter>`) real terminals use for Home/End/Delete. */
const TILDE_CSI_BY_PARAMS: Record<string, KeyEvent> = {
  "1": { kind: "home" },
  "7": { kind: "home" },
  "3": { kind: "delete" },
  "4": { kind: "end" },
  "8": { kind: "end" },
};

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Parse a chunk of raw stdin text (already decoded as utf8) into zero or more logical key
 * events. Handles common single-byte controls, `\x1b[<letter>` CSI sequences (arrows plus
 * bare Home/End), `\x1b[<n>~` CSI sequences (Home/End/Delete's other common encoding), and
 * bracketed-paste (`\x1b[200~...\x1b[201~`, see app.ts for enabling it on the terminal).
 * Multi-byte sequences split across chunk boundaries (rare for interactive typing, though
 * possible for a very large paste) are not reassembled — an incomplete trailing escape
 * sequence, or a paste whose closing marker hasn't arrived yet in this chunk, is reported as
 * `unknown` / a best-effort paste of what's present so far, respectively.
 */
export function parseKeys(input: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\x1b") {
      if (input.startsWith(PASTE_START, i)) {
        const start = i + PASTE_START.length;
        const endIndex = input.indexOf(PASTE_END, start);
        const textEnd = endIndex === -1 ? input.length : endIndex;
        events.push({ kind: "paste", text: input.slice(start, textEnd) });
        i = endIndex === -1 ? input.length : endIndex + PASTE_END.length;
        continue;
      }
      const next = input[i + 1];
      if (next === "[") {
        const letter = input[i + 2];
        if (letter !== undefined && letter in ARROW_BY_LETTER) {
          const key = ARROW_BY_LETTER[letter];
          if (key) events.push(key);
          i += 3;
          continue;
        }
        // Numeric `CSI <params> ~` form, e.g. \x1b[3~ (Delete).
        const tildeIndex = input.indexOf("~", i + 2);
        if (tildeIndex !== -1 && tildeIndex - (i + 2) <= 4) {
          const params = input.slice(i + 2, tildeIndex);
          if (/^\d+$/.test(params) && params in TILDE_CSI_BY_PARAMS) {
            const key = TILDE_CSI_BY_PARAMS[params];
            if (key) events.push(key);
            i = tildeIndex + 1;
            continue;
          }
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
