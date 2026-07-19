---
spile: ticket
id: DH-0207
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0140]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0207: Message queue: queued messages need visual 'queued' state + delete/cancel capability

## Summary

Manual testing finding (2026-07-19), UX gaps on top of DH-0140's already-confirmed-working queuing infrastructure: (1) queued messages show no visual distinction from sent messages in the Web UI -- users can't tell what's pending vs transmitted; (2) no way to delete/cancel a queued message before it's processed. Both needed for the message-queue feature to feel controllable rather than a black box. Web domain (Susan), depends on/extends DH-0140.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
