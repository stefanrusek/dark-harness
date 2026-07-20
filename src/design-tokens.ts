// DH-0137 (docs/design/style-guide.md §1/§1.2/§2.3): shared, framework-independent design
// tokens for the status/connection color+glyph+word tables — same "root-level src/ shared
// module, imported by both src/web/client/ and src/tui/" precedent as src/format.ts (DH-0104).
// Extracted so React (Web) and Ink (TUI) component trees can't independently re-derive these
// tables and silently drift from style-guide.md or from each other, the way STATUS_COLOR
// (src/tui/render.ts) and STATUS_STYLES (src/web/client/format.ts) previously did.
//
// Casing is a presentation-layer decision left to each consumer (style-guide.md §4): every
// `word`/label here is the canonical lowercase form; callers apply Title Case on Web
// themselves.
import type { AgentStatus } from "./contracts/log.type.ts";

/** The four connection-pill states (style-guide.md §1.2, DH-0105) — the client's canonical
 * `ConnectionStatus` (DH-0183: src/client-core/connection-status.ts, consumed by both TUI and
 * Web) is this same literal union; this module intentionally doesn't import it (design-tokens
 * is a lower-level, dependency-free module) and instead re-states the shared vocabulary once
 * here. */
export type ConnectionState = "connecting" | "live" | "reconnecting" | "disconnected";

export interface StatusToken {
  /** Canonical lowercase status word (style-guide.md §1). */
  word: string;
  /** Status dot glyph — `●` for every status per style-guide.md §3. */
  glyph: string;
  /** Web CSS custom-property name (style-guide.md §2.1), e.g. `--status-running`. */
  webVar: string;
  /** Web hex value (style-guide.md §1/§2.3), e.g. `#4f8cff`. */
  webHex: string;
  /** TUI/CLI SGR foreground code (style-guide.md §1/§2.3), e.g. `34`. */
  sgr: string;
}

export interface ConnectionToken {
  /** Web pill label, Title Case (style-guide.md §1.2/§4). */
  webLabel: string;
  /** TUI/CLI pill label, lowercase (style-guide.md §1.2/§4). */
  tuiLabel: string;
  /** SGR foreground code shared by both surfaces' rendering of this state. */
  sgr: string;
  /** True for the two pending/in-flight states (`connecting`, `reconnecting`) — style-guide.md
   * §1.1 — so a consumer doesn't need to re-derive "is this pending" from the label. */
  pending: boolean;
}

/** style-guide.md §1 — five `AgentStatus` values, one canonical glyph+word+color per status,
 * both surface representations from the one shared row so a color assignment can never
 * update on one surface without the other. */
export const STATUS_TOKENS: Record<AgentStatus, StatusToken> = Object.freeze({
  running: {
    word: "running",
    glyph: "●",
    webVar: "--status-running",
    webHex: "#4f8cff",
    sgr: "34",
  },
  waiting: {
    word: "waiting",
    glyph: "●",
    webVar: "--status-waiting",
    webHex: "#f5a524",
    sgr: "33",
  },
  done: { word: "done", glyph: "●", webVar: "--status-done", webHex: "#35c469", sgr: "32" },
  failed: { word: "failed", glyph: "●", webVar: "--status-failed", webHex: "#f2545b", sgr: "31" },
  stopped: {
    word: "stopped",
    glyph: "●",
    webVar: "--status-stopped",
    webHex: "#9a7bd1",
    sgr: "35",
  },
});

/** style-guide.md §1.2 (DH-0105) — four connection states, shared TUI/Web vocabulary. */
export const CONNECTION_TOKENS: Record<ConnectionState, ConnectionToken> = Object.freeze({
  connecting: { webLabel: "Connecting…", tuiLabel: "connecting…", sgr: "33", pending: true },
  live: { webLabel: "Live", tuiLabel: "live", sgr: "32", pending: false },
  reconnecting: { webLabel: "Reconnecting…", tuiLabel: "reconnecting…", sgr: "33", pending: true },
  disconnected: { webLabel: "Disconnected", tuiLabel: "disconnected", sgr: "31", pending: false },
});

// DH-0191: generic SGR (ANSI) primitive, shared by every terminal-facing surface (src/cli/,
// src/server/log-analysis.ts, src/tui/ink/tokens.ts) so each stops independently re-deriving
// the same `\x1b[<code>m...\x1b[0m` wrapping logic. This module was previously "about tables,
// not helpers" — but it's already the dependency-free root-level shared module every consumer
// here imports, so it's the natural home rather than adding a new sibling.
const SGR_PREFIX = "\x1b[";

/** The bare SGR reset escape sequence — terminates any `wrapSgr` color/style run. */
export const SGR_RESET = "\x1b[0m";

/** Wraps `text` in the SGR escape for `code` (a bare code string, e.g. `"34"`, `"1;36"` — the
 * same shape as `StatusToken.sgr`/`ConnectionToken.sgr` above) plus a trailing reset. Callers
 * remain responsible for their own TTY gating (style-guide.md §1: never color-only, and never
 * emit raw SGR bytes into a piped/non-TTY stream). */
export function wrapSgr(code: string, text: string): string {
  return `${SGR_PREFIX}${code}m${text}${SGR_RESET}`;
}

// DH-0221: truecolor brand palette + degradation primitives. This is the first place `dh`
// introduces 24-bit color. Per the architecture decision on this ticket, truecolor/ansi256
// foregrounds are just SGR *code* strings fed into the existing `wrapSgr`/`SGR_RESET`
// primitive above — no parallel escape-splicing logic, no second reset constant. Distinct
// concern from STATUS_TOKENS (semantic status colors, ANSI-16 only) — the two tables coexist
// here but are never merged.

/** How much color the active output stream supports. Resolved once at startup (the resolver
 * itself lives in `src/cli/color-context.ts`, which is impure — reads process.env/isTTY —
 * while this module stays pure/dependency-free). */
export type ColorLevel = "none" | "ansi256" | "truecolor";

/** DH-0220/DH-0219 brand/role palette. Truecolor hex is the source of truth; the same hex is
 * the Web CSS value (mirrors STATUS_TOKENS[].webHex). Distinct concern from STATUS_TOKENS —
 * do not merge the two tables. */
export const BRAND = Object.freeze({
  harnessGreen: "#9ECE6A", // ok states, ✓, live dot
  leadOrange: "#E0AF68", // warnings (no token), accents
  wireGray: "#565F89", // frame lines, dim labels
  signalCyan: "#7DCFFF", // URLs, interactive values
  boneWhite: "#C0CAF5", // primary values
} as const);
export type BrandName = keyof typeof BRAND;

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** "#RRGGBB" -> [r,g,b], 0-255. Throws on malformed input (fail loud, not silent black). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex);
  if (!m) {
    throw new Error(`hexToRgb: malformed hex color ${JSON.stringify(hex)}`);
  }
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const hex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/** Linear per-channel interpolation of two hexes; t clamped to [0,1]. Returns "#RRGGBB". Used
 * for the A2 wordmark's green->cyan gradient. */
export function lerpHex(a: string, b: string, t: number): string {
  const tc = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return toHex(ar + (br - ar) * tc, ag + (bg - ag) * tc, ab + (bb - ab) * tc);
}

// xterm-256 6x6x6 color cube channel steps (indices 16-231).
const CUBE_STEPS = Object.freeze([0, 95, 135, 175, 215, 255]);

function sqDist(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** Nearest xterm-256 index (0-255) for a hex. Compares the 6x6x6 color cube (indices 16-231,
 * channel steps [0,95,135,175,215,255]) AND the 24-step grayscale ramp (232-255), returns
 * whichever minimizes squared RGB distance. Pure; the only genuinely new algorithm. */
export function nearestAnsi256(hex: string): number {
  const rgb = hexToRgb(hex);

  // Nearest cube index per channel (independently minimizing each channel is optimal for a
  // uniform grid), then compute the actual cube color for a fair squared-distance compare
  // against the grayscale ramp.
  const nearestStepIdx = (v: number): number => {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < CUBE_STEPS.length; i++) {
      const d = Math.abs(v - (CUBE_STEPS[i] as number));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };
  const ri = nearestStepIdx(rgb[0]);
  const gi = nearestStepIdx(rgb[1]);
  const bi = nearestStepIdx(rgb[2]);
  const cubeIndex = 16 + 36 * ri + 6 * gi + bi;
  const cubeColor: [number, number, number] = [
    CUBE_STEPS[ri] as number,
    CUBE_STEPS[gi] as number,
    CUBE_STEPS[bi] as number,
  ];
  const cubeDist = sqDist(rgb, cubeColor);

  // Nearest grayscale ramp step (232-255 -> level 8, 18, ..., 238).
  let grayIndex = 232;
  let grayDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 24; i++) {
    const level = 8 + i * 10;
    const d = sqDist(rgb, [level, level, level]);
    if (d < grayDist) {
      grayDist = d;
      grayIndex = 232 + i;
    }
  }

  return grayDist < cubeDist ? grayIndex : cubeIndex;
}

/** Bare SGR foreground *code* for `wrapSgr` at the given level, or "" when level==="none". */
export function fgCode(hex: string, level: ColorLevel): string {
  if (level === "none") {
    return "";
  }
  if (level === "truecolor") {
    const [r, g, b] = hexToRgb(hex);
    return `38;2;${r};${g};${b}`;
  }
  return `38;5;${nearestAnsi256(hex)}`;
}

/** Paint text in a hex at a level. level==="none" returns text unchanged; otherwise
 * `wrapSgr(fgCode(hex, level), text)` — reusing the DH-0191 primitive, no new escape logic. */
export function paint(hex: string, text: string, level: ColorLevel): string {
  if (level === "none") {
    return text;
  }
  return wrapSgr(fgCode(hex, level), text);
}
