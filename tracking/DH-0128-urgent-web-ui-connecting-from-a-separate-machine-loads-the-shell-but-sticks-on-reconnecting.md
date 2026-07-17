---
spile: ticket
id: DH-0128
type: bug
status: draft
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

# DH-0128: URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...'

## Summary

Owner observation from live manual testing 2026-07-17: connecting to the web UI a second time from the same machine works fine, but connecting from a genuinely separate machine loads the UI shell (assets, layout) yet the connection pill never gets past 'Reconnecting...' -- the live SSE connection never establishes. Needs investigation: likely an SSE/EventSource issue specific to cross-machine access (CORS, host-binding/security.hostname interaction from DH-0022/0023, or an absolute-vs-relative URL bug similar in spirit to DH-0111's connect-web double-scheme bug). High-priority usability blocker for the core 'connect from another machine' use case this project cares about. Web domain (Susan) and/or Server (Radia) depending on root cause.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
