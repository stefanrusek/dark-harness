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

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
