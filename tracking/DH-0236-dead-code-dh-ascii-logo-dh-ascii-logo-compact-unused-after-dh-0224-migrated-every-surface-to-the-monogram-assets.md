---
spile: ticket
id: DH-0236
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0235]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0236: Dead code: DH_ASCII_LOGO / DH_ASCII_LOGO_COMPACT unused after DH-0224 migrated every surface to the monogram assets

## Summary

After DH-0224 pointed doctor/init/TUI/Web at HEADER_B_GLYPH / HEADER_A2_WORDMARK_PLAIN, the old figlet constants DH_ASCII_LOGO and DH_ASCII_LOGO_COMPACT in src/prompt/banner.constant.ts have no remaining product consumers — only their own test file references them. Delete both (and their tests), or document why they are retained.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
