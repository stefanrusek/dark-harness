// DH-0174 (Core, extracted from cli.ts): shared CLI styling helpers — docs/design/style-guide.md
// §1 (status colors), §1.1 (liveness), §2.2/§2.3 (SGR palette), §3 (glyphs), §5 (CLI
// conventions). Every TTY-gated color/glyph across init/doctor/server-startup/activity-feed
// goes through this one small module instead of each surface reinventing green/red/dim/✓/✗ —
// this generalizes what DH-0099 first did just for `dh doctor` (whose own DOCTOR_* constants
// alias these instead of duplicating the literals).
//
// Judgment call: the ticket's §5 text ("verdict glyphs (TTY-gated, color per §1)") reads as
// ambiguous about whether the TTY gate covers just the *color* or the glyph too. This module
// gates both together — off a TTY, every helper below returns "" (no glyph, no SGR) — which
// matches doctor's existing non-TTY behavior (plain "PASS"/"FAIL" words, no unicode at all)
// and is the safer choice for the ticket's own stated risk (piping into a log aggregator
// must stay byte-plain; some aggregators mis-handle non-ASCII as readily as raw SGR bytes).
//
// DH-0191: the bare "\x1b[<code>m...\x1b[0m" wrapping is now the shared `wrapSgr` primitive
// (src/design-tokens.ts) rather than an independent copy of the same splicing logic — every
// helper below is now a thin call into it. `CLI_RESET` is re-exported (rather than folded
// away) since help.ts's own section-header styling composes it directly with a bespoke
// cyan+bold code that has no single named helper here. The status→SGR map that used to be
// this module's own `CLI_STATUS_COLOR` copy is gone too — `cliStatusDot` now reads the
// canonical `STATUS_TOKENS[status].sgr` (design-tokens.ts, DH-0137) directly, same table Web
// and TUI already read, so a status color can never drift between surfaces (a regression-guard
// test in design-tokens.test.ts enforces that no other file independently re-declares that
// same shaped status-color table).
import type { AgentStatus } from "../contracts/index.ts";
import { SGR_RESET, STATUS_TOKENS, wrapSgr } from "../design-tokens.ts";

export const CLI_GREEN = "32";
export const CLI_RED = "31";
export const CLI_YELLOW = "33";
export const CLI_DIM = "2";
export const CLI_BOLD = "1";
export const CLI_RESET = Object.freeze(SGR_RESET);

export function cliColorize(text: string, code: string, tty: boolean): string {
  return tty ? wrapSgr(code, text) : text;
}

/** `✓ ` (green, TTY-only) prefix for a success headline; `""` off-TTY. */
export function cliSuccessGlyph(tty: boolean): string {
  return tty ? `${wrapSgr(CLI_GREEN, "✓")} ` : "";
}

/** `⚠ ` (yellow, TTY-only) prefix for a caution/posture note; `""` off-TTY. */
export function cliCautionGlyph(tty: boolean): string {
  return tty ? `${wrapSgr(CLI_YELLOW, "⚠")} ` : "";
}

/** Status-colored `●` (TTY-only) for an activity-feed lifecycle line; `""` off-TTY (the
 * status word itself still appears in the line — never color-only, per style-guide §1). */
export function cliStatusDot(status: AgentStatus, tty: boolean): string {
  return tty ? `${wrapSgr(STATUS_TOKENS[status].sgr, "●")} ` : "";
}

/** Dims text (TTY-only) — indented supporting detail/caveats, timestamps. */
export function cliDim(text: string, tty: boolean): string {
  return cliColorize(text, CLI_DIM, tty);
}

/** Bolds text (TTY-only) — light emphasis (`--version`'s app name). */
export function cliBold(text: string, tty: boolean): string {
  return cliColorize(text, CLI_BOLD, tty);
}
