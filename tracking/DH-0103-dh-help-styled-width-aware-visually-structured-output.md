---
spile: ticket
id: DH-0103
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0103: dh --help: styled, width-aware, visually structured output

## Summary

dh --help is the only fully-unstyled CLI surface: no color, and hand-hardcoded column spacing that misaligns and wraps awkwardly on narrow terminals (unlike the width-aware TUI). Give it visual structure per design-guide §5/§2.2 — sectioned, dynamically aligned to terminal width, TTY-gated color for the app name/section headers/flag names, dim descriptions.

`dh --help` (`HELP_TEXT`, `src/cli.ts` ~L155–195) is the only fully-unstyled CLI surface:
zero ANSI, and column alignment done with hand-hardcoded spaces (Usage descriptions aligned
around col ~34, Flags around ~27) that misalign and wrap awkwardly on any terminal narrower
than the author assumed — ironic next to the width-aware TUI two directories over. `--help`
is often the very first thing a new user runs; it should look composed. Owner: Grace
(`src/cli.ts`). Follows design guide §5 (CLI structure) and §2.2 (SGR usage).

## User Stories

### As a new user running `dh --help`, I want a clearly structured, scannable reference

- Given `--help` on a TTY, when it prints, then the app name/title is emphasized (bold), the
  section headers (`Usage:`, `Flags:`) are visually distinct (bold or cyan per §2.2), flag/
  subcommand names are lightly emphasized, and their descriptions are dim so the names pop.
- Given a two-column layout (name + description), when rendered, then the gutter between
  columns is computed from the widest name actually present, not a hardcoded magic column, so
  everything lines up regardless of the longest flag.

### As a user on a narrow terminal, I want help to wrap cleanly, not raggedly

- Given a terminal narrower than the natural two-column width, when `--help` prints, then
  descriptions wrap at word boundaries and continuation lines hang-indent to the description
  column (never wrap back under the flag name), reusing the TUI's word-wrap approach rather
  than letting the terminal hard-wrap mid-word.
- Given a very narrow terminal (below a sane threshold), when `--help` prints, then it
  degrades to a single-column stacked form (name line, indented description line) rather than
  an unreadable squeeze — a reasonable minimum-width fallback.

### As a user piping `dh --help` (or on a non-TTY), I want plain readable text

- Given stdout is not a TTY, when `--help` prints, then no ANSI is emitted; alignment/wrapping
  still use a sensible fixed width (e.g. 80 cols, or `$COLUMNS` if set) so redirected help is
  clean and stable.

## Functional Requirements

- Replace the static `HELP_TEXT` string with a structured renderer that (a) computes column
  width from the actual flag/subcommand names, (b) word-wraps descriptions to the terminal
  width with hang-indent, and (c) TTY-gates color per §2.2. Determine width from
  `process.stdout.columns` (fallback 80) — the same signal the TUI uses.
- Reuse existing word-wrap logic where possible (`src/tui/width.ts` `wrapText` is the
  reference implementation and already word-boundary-aware post-DH-0065) rather than writing
  a third wrapper — if it can't be imported across the domain boundary cleanly, request a
  shared text-wrap util (Core-owned) so TUI/help/(future CLI) share one implementation.
- Color scheme (TTY only): app name bold; section headers bold or cyan `36`; flag/subcommand
  names default or bold; descriptions dim `2`. No new SGR beyond the existing palette.
- Content stays the same (the flags/usage list is correct); this is layout + styling only.
- 100% coverage on changed code; test the width computation, the narrow-terminal wrap/hang-
  indent, the single-column fallback, and the non-TTY plaintext path. Verify live at a few
  widths (e.g. 120, 80, 40 cols) and describe the result in the closing report.

## Assumptions

- The set of flags/subcommands and their descriptions are correct as-is; no help *content*
  change is in scope (if a flag description is stale that's a separate ticket).
- 80 cols is an acceptable non-TTY default; `$COLUMNS`/`process.stdout.columns` wins when
  available.

## Risks

- Existing tests may assert on exact `HELP_TEXT` substrings/spacing; a dynamic renderer will
  change whitespace. Update those to assert on presence/structure (a flag appears with its
  description) rather than byte-exact spacing.
- Over-styling help hurts readability; keep it restrained (emphasis + dim, no rainbow). The
  design crew can review the exact palette in refining.

## Open Questions

- Minimum width threshold for the single-column fallback — pick a sensible value (e.g. when
  the description column would be < ~24 chars) at implementation; not worth pre-deciding here.

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew). Split out from the general CLI polish (DH-0101)
> because help specifically needs *layout* work (dynamic column width + word wrap), not just
> glyphs/color — it's a different kind of change and testable on its own. Lower urgency than
> init/doctor/server (help is read once), but it's the literal front door and currently the
> least-finished surface.
