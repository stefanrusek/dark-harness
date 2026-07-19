---
spile: ticket
id: DH-0192
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0121]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0192: Logo redesign: current mark is too literal and reads unintentionally suggestive

## Summary

Owner review of DH-0121's delivered logo (docs/media/logo.svg / ASCII banner in src/prompt/banner.ts), 2026-07-19: the current mark is too literal, and unfortunately reads as resembling genitals -- not the intended brand impression. Needs a real redesign pass, not a tweak. Route through Muriel (Design crew) first per CLAUDE.md's design-crew process (owns visual identity, CLAUDE.md section 7) to propose a new concept, then implementation to whichever domain(s) consume the result (Prompt for the ASCII banner text, Web for the SVG asset, TUI for ASCII rendering) -- same fan-out DH-0121 used. Both the SVG (docs/media/logo.svg) and ASCII-art (src/prompt/banner.ts's DH_ASCII_LOGO/DH_ASCII_LOGO_COMPACT) versions need to be revisited together since they're meant to share one visual identity.

**Owner design lead (2026-07-19):** doesn't dislike the ◆ black-diamond mark itself, and has
a concrete direction worth exploring before starting from zero — placed next to the words
"Dark Harness," the diamond reads like a **horse blinder** (the leather flap on a harness
that blocks peripheral vision), which fits the product name thematically. Worth exploring
whether the existing mark can be *evolved* toward that reading (shape/negative-space
adjustments that lean into the blinder association) rather than replaced outright — lower
risk than a from-scratch redesign, and reuses brand equity already spent on the ◆. Note the
diamond also isn't rendered consistently black across contexts today (the README shows it
black; the app doesn't always) — worth deciding whether it should be, as part of the same
pass.

This needs a real design hand (Fable, architect-on-call, standing in for Muriel/Design crew
per CLAUDE.md §7) to actually explore the concept — not an implementer guessing at shapes.

## User Stories

_To be written once Fable's design exploration produces a concrete direction to spec
against._

## Functional Requirements

- Fable to explore: can the existing ◆ mark evolve toward a "horse blinder" reading
  (leather-flap/harness association) through shape and negative-space changes, rather than
  a from-scratch redesign? Produce 2-3 concrete concept sketches/descriptions if the
  direction has legs; say clearly if it doesn't and a fresh start is genuinely needed.
- Resolve whether the diamond should render consistently black across every context
  (README, app UI, TUI ASCII) or whether context-appropriate color variation is intentional
  and fine.
- Still needs both an SVG (docs/media/logo.svg) and ASCII-art (src/prompt/banner.ts) version
  sharing one visual identity, per DH-0121's original scope.

## Assumptions

## Risks

- Design taste is inherently subjective — Fable should present options with reasoning, not
  just pick one, so the owner has a real choice rather than a fait accompli.

## Open Questions

## Notes
