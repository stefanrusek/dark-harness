---
spile: ticket
id: DH-0124
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0124: TUI empty-state before first message is misleading -- show app header + friendlier prompt

## Summary

Owner observation from live manual testing 2026-07-17: the TUI's initial history-window message ('Waiting for root agent to start...') is technically true but misleading -- it's really waiting for the operator's first message, not for the root agent itself to spin up. Should instead show a lighter variant of the new application header (see sibling header ticket -- fewer dh.json settings than the full version) plus a friendly prompt inviting the first message. TUI domain (Mary), depends on the app-header ticket landing first for the shared header-building logic.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
