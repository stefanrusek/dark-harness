---
spile: ticket
id: DH-0247
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0247: Header B: framed panel's right border drifts, no padding to frame width on dynamic content rows

## Summary

Owner screenshot report (2026-07-20): Header B's config/bind/web ui/logs rows appended the closing right border immediately after each row's own text with no padding to the frame's interior width, so the right edge drifted to a different column on every row instead of forming a straight line matching the box's top/bottom corners. Fixed in src/cli/header.ts by adding a shared row() helper that pads every framed row's content to the frame's interior width (using visibleLen() so SGR color codes don't get miscounted) before appending the closing border -- also applied to the two glyph/tagline rows, which previously used hand-tuned, easily-stale padding instead of a real width calculation. Added a real regression test (src/cli/header.test.ts) asserting every framed row's true visible length is identical, which fails against the pre-fix code and passes against the fix. Verified visually via a real PTY capture of the compiled binary.

## User Stories

### As an operator looking at Header B, I want the framed panel's right border to form a straight line

- Given `dh --server`/`dh --web` starts with color enabled, when Header B renders, then every
  row's right `│` lands at the same visible column as the frame's own `╭`/`╮`/`├`/`┤`/`╰`/`╯`
  corners — proven by `src/cli/header.test.ts`: "every framed row's right border lands at the
  same visible column (DH-0247)", which asserts every framed row's SGR-stripped visible length
  is identical, for both `ansi256` and `truecolor` levels.

## Functional Requirements

- `src/cli/header.ts`'s `renderHeaderB` gains a shared `row(content)` helper: pads `content` to
  the frame's interior width (`width - 2`, accounting for the "  " lead-in after the left `│`)
  using the existing `visibleLen()` helper (already used for the top-border fill, so SGR-colored
  content is measured correctly) before appending the closing `frame("│")`.
- All framed content rows — the two glyph/tagline rows and the dynamic config/bind/web ui/logs
  rows — go through this one helper. The glyph/tagline rows previously used hand-tuned literal
  spacing (`" ".repeat(6)`, `" ".repeat(1)`) that happened to work only because those two
  strings are fixed constants; this is now computed the same way as the dynamic rows so it
  can't drift if the wordmark/tagline strings ever change length.

## Assumptions

- The plain (`level === "none"`) fallback path is unaffected — it doesn't use box-drawing
  characters at all, so there's no right-border alignment concept to fix there.

## Risks

- None beyond the fix itself — purely a rendering/padding calculation, no behavioral/data
  change.

## Open Questions

None.

## Notes

Found via an owner screenshot during live use, fixed directly by the coordinator (2026-07-20).
Verified two ways: a real regression test (confirmed to fail against the pre-fix code) and a
visual check via a real PTY (`tmux`) capture of the compiled binary, confirming the frame's
right edge now forms a clean straight column exactly matching the mockup this ticket's parent
tickets (DH-0220/0221) specified.
