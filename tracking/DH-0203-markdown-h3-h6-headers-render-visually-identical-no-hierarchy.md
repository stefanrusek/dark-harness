---
spile: ticket
id: DH-0203
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0108, DH-0109]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0203: Markdown: H3-H6 headers render visually identical, no hierarchy

## Summary

Manual testing finding (2026-07-19): only H1/H2 have distinct visual styling in the Web markdown renderer; H3 through H6 all render identically, losing document hierarchy for content that uses deeper heading levels. Needs a real (even if subtle) size/weight scale across all six levels. Web domain (Susan), touches shared markdown rendering (src/markdown/) -- check TUI too once TUI verification is unblocked.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
