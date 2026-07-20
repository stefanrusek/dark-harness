// DH-0126: SGR-1006 mouse-sequence parsing and protocol control strings — ported from
// privateer's `src/input/mouse.ts` (cited in this ticket's Notes as working prior art for
// this exact bug: a terminal's raw scroll-wheel bytes, left unparsed, land in the composer as
// garbage keystrokes). This module is pure/testable; app.ts owns the actual stdin/stdout
// wiring around it (mirrors privateer's split between `src/input/mouse.ts` and
// `mouse-lifecycle.ts`).
//
// SGR 1006 format:
//   Press / motion:  ESC [ < Cb ; Cx ; Cy M
//   Release:         ESC [ < Cb ; Cx ; Cy m
//
// Button bits (Cb):
//   bits 0-1: button number (0=left, 1=middle, 2=right, 3=none/motion)
//   bit  2:   Shift modifier
//   bit  3:   Meta/Alt modifier
//   bit  4:   Ctrl modifier
//   bit  5:   motion (32) flag — any-motion event
//   bit  6:   wheel (64) flag — scroll event

export type MouseEventType = "down" | "up" | "move" | "drag" | "scrollUp" | "scrollDown";

export interface MouseEvent {
  type: MouseEventType;
  button: number;
  x: number;
  y: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

/** Enable mouse reporting: click tracking (1000h) + button-held motion (1002h) + SGR extended
 * coordinates (1006h). Any-motion tracking (1003h) is deliberately left off — it floods the
 * stream and would only add noise dark-harness doesn't consume. */
export const MOUSE_ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";

/** Disable every mouse reporting mode (including ones this module never enables, so a
 * terminal left in another tool's any-motion/urxvt mode is cleaned up too) — escape
 * sequences must never leak into the shell after the TUI exits. */
export const MOUSE_DISABLE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l";

// Bit masks for the Cb byte
const BUTTON_MASK = 0b00000011;
const SHIFT_BIT = 0b00000100;
const META_BIT = 0b00001000;
const CTRL_BIT = 0b00010000;
const MOTION_BIT = 0b00100000;
const WHEEL_BIT = 0b01000000;

// Use RegExp constructor to avoid the no-control-regex lint rule — the ESC byte (0x1B) is a
// legitimate part of the SGR 1006 protocol.
const SGR_MOUSE_RE = new RegExp(`^${String.fromCodePoint(0x1b)}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`);

// A global, non-anchored variant for splitting a chunk that may carry several reports
// (terminals coalesce rapid wheel/motion events into one read) plus interleaved non-mouse
// bytes.
const SGR_MOUSE_SPLIT_RE = new RegExp(`${String.fromCodePoint(0x1b)}\\[<\\d+;\\d+;\\d+[Mm]`, "g");

// A trailing, *incomplete* SGR mouse introducer — covers the rare case where a terminal
// splits one report across two stdin reads (the sequence is short, ~9-12 bytes, but nothing
// guarantees it lands in a single `data` event). Left unstripped, the fragment's digits would
// fall through to `parseKeys` as literal characters, same bug as an unstripped whole sequence.
//
// Deliberately requires the full `ESC[<` introducer, not just a bare trailing ESC or ESC[ —
// those are ambiguous with a real standalone Escape keypress or an ordinary (non-mouse) CSI
// sequence a real terminal can deliver as its own single-byte `data` chunk (e.g. pressing Esc
// alone to cancel something). Buffering those as a "partial mouse sequence" would delay a real
// Escape keystroke into the next `data` event instead of dispatching it immediately — a
// regression discovered via the real-PTY e2e suite while fixing DH-0230, see mouse.ts's
// MouseChunkAssembler doc comment.
const SGR_MOUSE_PARTIAL_TRAILING_RE = new RegExp(`${String.fromCodePoint(0x1b)}\\[<[\\d;]*$`);

/**
 * Split one stdin read into its constituent SGR mouse events. A single read can carry several
 * reports interleaved with unrelated bytes; this extracts every SGR sequence in order and
 * parses each one. Non-mouse bytes are ignored.
 */
export function parseSgrMouseChunk(chunk: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  for (const match of chunk.matchAll(SGR_MOUSE_SPLIT_RE)) {
    const evt = parseSgrMouse(match[0]);
    if (evt !== null) {
      events.push(evt);
    }
  }
  return events;
}

/**
 * Remove every complete SGR mouse sequence, plus a trailing incomplete one, from a raw stdin
 * chunk — what's left is safe to hand to `parseKeys`. This is the fix for DH-0126's actual
 * bug: `parseKeys` doesn't recognize the `[<...M` introducer, falls through to its
 * "unrecognized CSI" branch, consumes only the first 3 bytes as `unknown`, and then reads the
 * sequence's digits/semicolons back out as literal `char` keystrokes into the composer.
 */
export function stripSgrMouseSequences(chunk: string): string {
  return chunk.replace(SGR_MOUSE_SPLIT_RE, "").replace(SGR_MOUSE_PARTIAL_TRAILING_RE, "");
}

// DH-0230: an SGR sequence is at most ~15 bytes for any coordinate pair a real terminal
// reports (ESC [ < NNN ; NNNN ; NNNN M). A "partial" carried across chunk boundaries that
// grows past this is not a split mouse sequence in flight — it's ordinary text that happens
// to start with the introducer — so the assembler below abandons the carry rather than
// buffering it forever.
const MAX_PARTIAL_LEN = 24;

function trailingPartial(text: string): string {
  const m = SGR_MOUSE_PARTIAL_TRAILING_RE.exec(text);
  return m !== null ? m[0] : "";
}

/**
 * Reassembles SGR mouse sequences that a terminal splits across two stdin `data` events.
 * Each SGR mouse scroll notch is itself a short ANSI escape sequence (`ESC[<...M`) read off
 * stdin; under rapid/aggressive scrolling the PTY delivers many of these back-to-back and
 * the OS-level read buffer can split one mid-sequence — e.g. `ESC[<64;10` in one `data`
 * event and `;20M` in the next. `parseSgrMouseChunk`/`stripSgrMouseSequences` alone only
 * recognize a trailing partial *within* a single chunk (and correctly drop it there); the
 * continuation fragment arriving in the *next* chunk has no `ESC[<` prefix, so on its own it
 * looks like ordinary text and falls through to `parseKeys` as literal garbage characters
 * (DH-0230). This class fixes that by carrying an unresolved trailing partial forward and
 * prepending it to the next chunk before parsing, so a sequence split at any point *after*
 * the `ESC[<` introducer has already arrived is reassembled and parsed whole. (A split before
 * that point — e.g. a bare trailing `ESC` — is deliberately left unbuffered: see
 * `SGR_MOUSE_PARTIAL_TRAILING_RE`'s doc comment for why treating that as a mouse partial
 * regressed real standalone Escape keypresses.) Pure/stateful but no I/O — app.ts owns one
 * instance per session and feeds it every stdin chunk in arrival order.
 */
export class MouseChunkAssembler {
  private carry = "";

  /**
   * Feed the next raw stdin chunk. Returns every complete SGR mouse event found (across the
   * carried-over partial plus this chunk) and `rest`: the chunk's non-mouse bytes, safe to
   * hand to `parseKeys` — with all complete mouse sequences and any new trailing partial
   * removed (the partial is retained internally and re-prepended on the next call).
   */
  process(chunk: string): { events: MouseEvent[]; rest: string } {
    const combined = this.carry + chunk;
    const events = parseSgrMouseChunk(combined);
    const withoutComplete = combined.replace(SGR_MOUSE_SPLIT_RE, "");
    const partial = trailingPartial(withoutComplete);
    if (partial.length > 0 && partial.length <= MAX_PARTIAL_LEN) {
      this.carry = partial;
      return { events, rest: withoutComplete.slice(0, withoutComplete.length - partial.length) };
    }
    // No partial, or an implausibly long one (not actually a split mouse sequence) — don't
    // buffer it; let it fall through to parseKeys like ordinary text.
    this.carry = "";
    return { events, rest: withoutComplete };
  }
}

/**
 * Parse one SGR mouse sequence into a structured MouseEvent. Returns null if the input does
 * not match the expected format.
 */
export function parseSgrMouse(seq: string): MouseEvent | null {
  const m = SGR_MOUSE_RE.exec(seq);
  if (m === null) {
    return null;
  }

  // All four capture groups are mandatory in the regex, so they are always defined after a
  // successful exec(). Destructure with fallbacks that can never actually fire — this
  // satisfies noUncheckedIndexedAccess without introducing an unreachable branch.
  const [, rawCb = "", rawX = "", rawY = "", final = ""] = m;

  // Regex groups 1-3 match \d+ so parseInt cannot return NaN
  const cb = Number.parseInt(rawCb, 10);
  const x = Number.parseInt(rawX, 10);
  const y = Number.parseInt(rawY, 10);

  const rawButton = cb & BUTTON_MASK;
  const isMotion = (cb & MOTION_BIT) !== 0;
  const isWheel = (cb & WHEEL_BIT) !== 0;
  const isRelease = final === "m";

  let type: MouseEventType;
  if (isWheel) {
    // Wheel: button bit 0 distinguishes up (0) from down (1)
    type = rawButton === 1 ? "scrollDown" : "scrollUp";
  } else if (isRelease) {
    type = "up";
  } else if (isMotion) {
    // Motion with a button held (button < 3) = drag; without = move
    type = rawButton < 3 ? "drag" : "move";
  } else {
    type = "down";
  }

  return {
    type,
    button: rawButton,
    x,
    y,
    shift: (cb & SHIFT_BIT) !== 0,
    meta: (cb & META_BIT) !== 0,
    ctrl: (cb & CTRL_BIT) !== 0,
  };
}
