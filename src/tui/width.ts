// Visual-width-aware text measurement and wrapping (DH-0025). Plain `string.length` counts
// UTF-16 *code units*, not the terminal's actual displayed width: surrogate pairs (emoji,
// many CJK codepoints outside the Basic Multilingual Plane) are 2 code units for 1 codepoint,
// "wide" East-Asian characters occupy 2 terminal columns, and Unicode combining marks occupy
// 0 columns (they combine with the preceding character rather than advancing the cursor).
// Every wrap/measure/trim code path in the TUI must go through here instead of `.length`/
// `.slice()`, or CJK/emoji/combining-mark text misaligns the frame and can split a surrogate
// pair into a corrupted lone surrogate at a trim boundary.
//
// This is deliberately not a full Unicode grapheme-cluster segmenter (no `Intl.Segmenter`
// dependency assumed available/consistent across the compiled-binary + any future non-Bun
// target): it measures one codepoint at a time. Combining marks and wide characters each get
// the right *column width*, so alignment never corrupts, even though multi-codepoint emoji
// sequences (skin-tone modifiers, ZWJ sequences) aren't visually clustered into one "unit"
// for trimming purposes.

/** Split text into an array of single Unicode codepoints (not UTF-16 code units) —
 * `Array.from`/the spread operator both iterate strings by codepoint, correctly keeping a
 * surrogate pair together as one entry. */
export function codePoints(text: string): string[] {
  return Array.from(text);
}

const COMBINING_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f], // zero-width space/joiners/marks
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], // BOM / zero width no-break space
];

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2329, 0x232a],
  [0x2e80, 0x303e], // CJK Radicals Supplement .. CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables/Radicals
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff], // emoji blocks (misc symbols/pictographs, transport, supplemental, etc.)
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B and beyond / supplementary plane
];

function inRanges(code: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

/** Visual column width of a single codepoint: 0 (combining/zero-width), 1 (ordinary), or 2
 * (wide — CJK ideographs, fullwidth forms, most emoji). `\t` and `\n` are treated as width 1
 * here (control handling/expansion is the caller's concern — `wrapText` never sees a `\n`,
 * since it splits on that first). */
export function charWidth(ch: string): 0 | 1 | 2 {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if (inRanges(code, COMBINING_RANGES)) return 0;
  if (inRanges(code, WIDE_RANGES)) return 2;
  return 1;
}

/** Visual display width of an entire string (sum of per-codepoint widths, ignoring `\n`
 * splitting — callers that need per-line width should split first). */
export function stringWidth(text: string): number {
  let width = 0;
  for (const cp of codePoints(text)) width += charWidth(cp);
  return width;
}

/** Greedily wrap text to `cols` *visual columns* wide, honoring existing newlines, measuring
 * and slicing by codepoint (never splitting a surrogate pair) and by display width (never
 * splitting a wide character's column pair across rows unless a single wide character alone
 * already exceeds `cols`, which is allowed to overflow by one column rather than infinite-
 * loop or drop the character). */
export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, cols);
  const out: string[] = [];
  const sourceLines = text.split("\n");
  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      out.push("");
      continue;
    }
    let cur = "";
    let curWidth = 0;
    for (const cp of codePoints(sourceLine)) {
      const w = charWidth(cp);
      if (curWidth + w > width && cur.length > 0) {
        out.push(cur);
        cur = "";
        curWidth = 0;
      }
      cur += cp;
      curWidth += w;
    }
    out.push(cur);
  }
  return out;
}

/** Take up to `maxChars` *codepoints* from the front (`fromEnd: false`) or back (`fromEnd:
 * true`) of `text`, never splitting a surrogate pair — the fix for DH-0025's "trim boundary
 * splits a multi-code-unit character" bug, which `str.slice(n)`/`str.length` (UTF-16 code
 * unit based) can do for any codepoint outside the Basic Multilingual Plane. */
export function sliceCodePoints(text: string, count: number, fromEnd: boolean): string {
  const cps = codePoints(text);
  if (count >= cps.length) return text;
  const bounded = Math.max(0, count);
  return fromEnd ? cps.slice(cps.length - bounded).join("") : cps.slice(0, bounded).join("");
}

/** Codepoint count of `text` — the surrogate-pair-safe equivalent of `.length` for anything
 * that needs "how many characters", not "how many display columns". */
export function codePointLength(text: string): number {
  return codePoints(text).length;
}
