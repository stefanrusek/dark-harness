---
spile: ticket
id: DH-0200
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0129]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0200: Web: 'Jump to Latest' button disappears after mouse-wheel scroll, doesn't reappear consistently

## Summary

Manual testing finding (2026-07-19): after scrolling up with the mouse wheel, the 'Jump to Latest' button disappears entirely rather than staying available to jump back down. It correctly reappears when a new operator message pushes the transcript, so the logic exists but is inconsistently triggered. Likely the same state-management area as DH-0129 (autoscroll undershoot) -- worth fixing together. Web domain (Susan).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
