---
spile: ticket
id: DH-0168
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0166, DH-0167]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0168: --web hardcodes a random port instead of an operator-chosen one

## Summary

src/cli.ts's --web call site hardcodes port: 0 (OS-assigned random ephemeral port) when constructing the web UI's own listening server — there is currently no way for an operator to pin --web to a specific port. Raised as an open question during manual test-build verification (2026-07-18), not yet a directive to change: owner wants to discuss whether this should become configurable (e.g. a --web-port flag or dh.json field) before any implementation. Do not implement until that discussion happens and a direction is chosen.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
