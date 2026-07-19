---
spile: ticket
id: DH-0225
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0221]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0225: Startup-header health dot green diverges from STATUS_TOKENS status-dot green (DH-0221 palette fragmentation)

## Summary

DH-0221 introduced the BRAND palette (Tokyo-Night-ish) alongside the pre-existing STATUS_TOKENS. The new startup header paints its health '●' with BRAND.harnessGreen (#9ECE6A) for ok, while the TUI/Web status dots use STATUS_TOKENS greens for the same '●' glyph/semantics (done #35c469, running/live #4f8cff). So 'ok/live/green' now renders as three different greens depending on surface. design-tokens.ts deliberately documents that the two tables 'coexist but are never merged' — so this is NOT a request to merge the palettes, but a UX-consistency call on which green a live/ok dot should be across surfaces. Route to Design (Muriel) for the call rather than an implementer silently reconciling it against the documented coexistence decision.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
