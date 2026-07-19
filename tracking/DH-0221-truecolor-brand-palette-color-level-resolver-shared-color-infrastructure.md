---
spile: ticket
id: DH-0221
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0220, DH-0219]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0221: Truecolor brand palette + color-level resolver (shared color infrastructure)

## Summary

Foundational, framework-independent color module that DH-0220's two startup headers (and the TUI/Web Markdown-color rendering the same ticket adds) build on: the 5-color truecolor brand palette, a runtime color-level resolver (truecolor / ansi256 / none) honoring COLORTERM/NO_COLOR/--plain/non-TTY, and a pure hex->nearest-xterm-256 downsample. Split out of DH-0220 because it is reusable infrastructure consumed by more than the headers and is independently unit-testable to the 100% gate.

## Architecture decision (Fable, 2026-07-19)

This is the first place `dh` introduces 24-bit color. The call — made here so DH-0220's
implementer builds against a real design, not an ad-hoc truecolor system:

**Truecolor is NOT a new SGR system — it rides the existing `wrapSgr`/`SGR_RESET`
primitive (DH-0191, `src/design-tokens.ts`).** A truecolor foreground is just another SGR
parameter string: `38;2;<r>;<g>;<b>`. An ansi-256 foreground is `38;5;<n>`. Both are the
exact `code` shape `wrapSgr(code, text)` already accepts (same as `"34"`, `"1;36"`). So the
degradation path produces a *code string*, and the existing wrapper emits it. No parallel
escape-splicing logic, no second reset constant.

**`STATUS_TOKENS` stays exactly as-is and is untouched by this ticket.** It is a *semantic
status vocabulary* (running/waiting/done/failed/stopped → fixed ANSI 16-color SGR), a
different concern from a *brand/role palette*. The two coexist as orthogonal tables in the
same module; do not fold status colors into the brand palette or upgrade them to truecolor
here.

**Home:** everything below lands in `src/design-tokens.ts` — already the dependency-free,
framework-independent shared module every terminal-facing surface *and* both React/Ink
client trees import (its DH-0191 header explicitly chose it as the home for shared color
primitives rather than a sibling). The brand hex values double as the Web CSS source of
truth (mirroring `STATUS_TOKENS[].webHex`), which is why the palette must live in the pure
shared module and not in a CLI-only file. **Exception — the resolver is impure** (it reads
`process.env`/`isTTY`), and `design-tokens.ts` is documented pure/no-process; so the
*detection* function lives in Core at `src/cli/color-context.ts`, while the pure palette +
downsample + paint primitives it feeds live in `design-tokens.ts`.

**Ownership:** shared primitives in `src/design-tokens.ts` and the resolver in
`src/cli/color-context.ts` are **Core** (Grace). Web's consumption of the brand hexes for
Markdown coloring is **Web** (Susan); TUI's is **TUI** (Mary) — both just import the table.
No `src/contracts/` change (this is presentation, not wire truth), so no architect gate
beyond this pass.

## User Stories

### As a header/log renderer, I want to paint text in a named brand color at whatever depth the terminal supports

- Given a resolved `ColorLevel` of `"truecolor"`, when I `paint(BRAND.harnessGreen, "✓", level)`,
  then the output is `\x1b[38;2;158;206;106m✓\x1b[0m`.
- Given a resolved `ColorLevel` of `"ansi256"`, when I paint the same color, then the output
  uses the precomputed nearest xterm-256 index (`\x1b[38;5;149m✓\x1b[0m`).
- Given a resolved `ColorLevel` of `"none"`, when I paint any color, then the text is
  returned verbatim with no escape bytes.

### As the CLI startup path, I want one place that decides the terminal's color depth from env + TTY

- Given `--plain` is passed OR `NO_COLOR` is present in the environment OR stdout is not a
  TTY, when `detectColorLevel` runs, then it returns `"none"`.
- Given a TTY with `COLORTERM=truecolor` (or `24bit`) and no NO_COLOR/--plain, when
  `detectColorLevel` runs, then it returns `"truecolor"`.
- Given a TTY with color allowed but `COLORTERM` unset/other, when `detectColorLevel` runs,
  then it returns `"ansi256"`.

### As the gradient wordmark, I want intermediate colors between two brand hexes downsampled correctly

- Given two hexes and a `t` in `[0,1]`, when `lerpHex(a, b, t)` runs, then it returns the
  linearly-interpolated hex, which `paint` can then render at any level (truecolor exact,
  ansi256 via `nearestAnsi256`).

### As a maintainer, I want the palette's precomputed ansi-256 indices proven correct

- Given each `BRAND` entry, when the test suite runs, then `nearestAnsi256(hex)` is asserted
  to equal the documented index (regression guard against a hand-edited hex drifting from its
  cached downsample).

## Functional Requirements

Concrete module design the implementer builds against verbatim.

### `src/design-tokens.ts` additions (pure, shared — Core)

```ts
/** How much color the active output stream supports. Resolved once at startup. */
export type ColorLevel = "none" | "ansi256" | "truecolor";

/** DH-0220/DH-0219 brand/role palette. Truecolor hex is the source of truth; the same hex
 * is the Web CSS value. Distinct concern from STATUS_TOKENS (semantic status colors) — do
 * not merge. */
export const BRAND = Object.freeze({
  harnessGreen: "#9ECE6A", // ok states, ✓, live dot
  leadOrange:   "#E0AF68", // warnings (no token), accents
  wireGray:     "#565F89", // frame lines, dim labels
  signalCyan:   "#7DCFFF", // URLs, interactive values
  boneWhite:    "#C0CAF5", // primary values
} as const);
export type BrandName = keyof typeof BRAND;

/** "#RRGGBB" -> [r,g,b], 0–255. Throws on malformed input (fail loud, not silent black). */
export function hexToRgb(hex: string): [number, number, number];

/** Linear per-channel interpolation of two hexes; t clamped to [0,1]. Returns "#RRGGBB".
 * Used for the A2 wordmark's green→cyan gradient. */
export function lerpHex(a: string, b: string, t: number): string;

/** Nearest xterm-256 index (0–255) for a hex. Compares the 6×6×6 color cube (indices
 * 16–231, channel steps [0,95,135,175,215,255]) AND the 24-step grayscale ramp (232–255),
 * returns whichever minimizes squared RGB distance. Pure; the only genuinely new algorithm. */
export function nearestAnsi256(hex: string): number;

/** Bare SGR foreground *code* for `wrapSgr` at the given level, or "" when level==="none".
 *   truecolor -> `38;2;${r};${g};${b}`
 *   ansi256   -> `38;5;${nearestAnsi256(hex)}` */
export function fgCode(hex: string, level: ColorLevel): string;

/** Paint text in a hex at a level. level==="none" returns text unchanged; otherwise
 * `wrapSgr(fgCode(hex, level), text)` — reusing the DH-0191 primitive, no new escape logic. */
export function paint(hex: string, text: string, level: ColorLevel): string;
```

- Precomputed nearest-256 indices (asserted by test, not hand-maintained divergently):
  harnessGreen→149, leadOrange→179, wireGray→60, signalCyan→117, boneWhite→189.
- `nearestAnsi256` is the one new algorithm and the sharp edge for 100% coverage — cover the
  cube branch, the grayscale-ramp branch, and a tie. Everything else is trivial string work.
- `paint`/`fgCode` reuse `wrapSgr`/`SGR_RESET`; do not introduce a second reset or a
  truecolor-specific wrapper.

### `src/cli/color-context.ts` (impure resolver — Core)

```ts
import type { ColorLevel } from "../design-tokens.ts";

export interface ColorLevelInputs {
  isTTY: boolean;                          // process.stdout.isTTY === true
  env: Record<string, string | undefined>; // process.env
  plain: boolean;                          // --plain flag
}

/** Resolve color depth. Precedence: --plain / NO_COLOR / non-TTY force "none";
 * COLORTERM in {truecolor,24bit} -> "truecolor"; else "ansi256". */
export function detectColorLevel(inp: ColorLevelInputs): ColorLevel;
```

- `NO_COLOR`: honor the informal standard — *presence disables*, regardless of value
  (`inp.env.NO_COLOR !== undefined`). Document this explicitly in the function.
- Kept a pure function of injected inputs (not reading `process` directly) so it is
  unit-testable without global mutation — the CLI entry passes `process.stdout.isTTY`,
  `process.env`, and the parsed `--plain` flag in.
- No `FORCE_COLOR` handling — out of scope; add only if a real need appears.

### Relationship to the header renderer (DH-0220)

- DH-0220's header code calls `detectColorLevel(...)` once at startup, then threads the
  resulting `ColorLevel` into its A2/B renderers, using `paint(BRAND.x, text, level)` and
  `lerpHex` for the gradient.
- The "plain-text fallback" mode DH-0220 describes (no box-drawing, no gradient, ASCII
  wordmark) is triggered by `level === "none" || sizeGateFails` — a clean single predicate,
  since NO_COLOR/--plain/non-TTY all collapse to `level === "none"` here, and the unicode art
  is inseparable from color in that design. That gating logic is DH-0220's, not this ticket's.

## Assumptions

- Callers TTY-gate via the resolved `ColorLevel`; no primitive here reads `process` itself
  except the clearly-marked resolver (kept in Core for exactly that reason).
- The 5 brand hexes are the frozen source of truth for both terminal SGR and Web CSS; no
  surface re-declares them (same anti-drift stance as `STATUS_TOKENS`, and a design-tokens
  test can guard against re-declaration if warranted).

## Risks

- `nearestAnsi256` is the only nontrivial logic; an off-by-one in the channel-step table or
  skipping the grayscale ramp yields subtly wrong degraded colors. The palette round-trip
  test (User Story #4) plus explicit cube/ramp/tie cases are the guard.

## Notes

Split out of DH-0220 (2026-07-19 Fable architecture pass). DH-0220 depends on this landing
first. Also consumed by DH-0220's owner-added TUI/Web Markdown-color rendering and referenced
by DH-0219's logo palette — hence its own reusable-infrastructure ticket rather than being
buried inside the header ticket.
