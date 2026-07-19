---
spile: ticket
id: DH-0208
type: bug
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

# DH-0208: Message queue: script hangs indefinitely with no completion/EOF signal

## Summary

Manual testing finding (2026-07-19): queued 5 messages during an agent sleep period; the agent successfully resumed and processed them (core queuing infra confirmed working), but the driving script then hung waiting for input indefinitely -- no explicit EOF or message-count-limit termination signal exists. Message queuing needs proper completion semantics so a --job-driven or scripted caller can know when it's actually done, not just when the queue drains once. Core domain, extends DH-0140.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
