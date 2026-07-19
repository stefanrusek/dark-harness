---
spile: ticket
id: DH-0202
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

# DH-0202: Web: model name shows '(unknown model)' after SSE reconnect

## Summary

Manual testing finding (2026-07-19): after a page reload triggers SSE reconnect (Last-Event-ID resume), the transcript is correctly preserved but the active model name displays as '(unknown model)' instead of the real model (e.g. 'bedrock haiku'). Model info should be preserved across reconnect or re-fetched as part of the reconnect handshake. Web domain (Susan).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
