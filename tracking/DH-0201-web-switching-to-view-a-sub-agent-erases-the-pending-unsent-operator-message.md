---
spile: ticket
id: DH-0201
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0201: Web: switching to view a sub-agent erases the pending (unsent) operator message

## Summary

Manual testing finding (2026-07-19), real data-loss bug: type a message in the composer, then click to view a sub-agent's detail pane -- the typed, unsent text disappears from the input box. User must retype. Should preserve pending composer input across agent-view switches (likely needs per-composer-instance state, or lifting composer state above the agent-view-switch remount boundary). Web domain (Susan).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
