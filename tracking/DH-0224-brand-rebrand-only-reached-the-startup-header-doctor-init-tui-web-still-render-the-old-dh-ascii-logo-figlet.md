---
spile: ticket
id: DH-0224
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0219]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0224: Brand rebrand only reached the startup header; doctor/init/TUI/Web still render the old DH_ASCII_LOGO figlet

## Summary

DH-0219/DH-0220 introduced the new DH monogram + ANSI-Shadow wordmark (HEADER_A2_WORDMARK / HEADER_B_GLYPH) but only for the run.ts startup header. Every other surface still prints the pre-rebrand DH_ASCII_LOGO / DH_ASCII_LOGO_COMPACT figlet via header-info.ts's formatHeaderLines/formatEmptyStateLines: 'dh doctor' and 'dh init' (printAppHeader in cli/activity-feed.ts), the TUI empty-state (RootView), and the Web AppHeader logo. Result is two coexisting visual identities for the same product. Spans Core (activity-feed/header-info), TUI, and Web — cannot be cleanly sliced to one owner per CLAUDE.md §3; flag for coordinator triage on decomposition (whether secondary surfaces adopt the monogram, and who owns each). Note also the stale TODO at src/tui/ink/Header.tsx:10 referencing DH-0124's empty variant.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
