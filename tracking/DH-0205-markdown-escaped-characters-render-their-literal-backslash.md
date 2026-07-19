---
spile: ticket
id: DH-0205
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0108]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0205: Markdown: escaped characters render their literal backslash

## Summary

Manual testing finding (2026-07-19): \* renders as the literal two characters \* instead of an escaped asterisk. Standard markdown character-escaping isn't implemented/working in the current renderer. Real correctness bug, not a feature gap.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
