---
spile: ticket
id: DH-0116
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0003]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0116: --server mode's AgentRuntime sessionId mismatches the outer logDir cli.ts uses

## Summary

Found by DH-0003's implementer while building SendMessage-to-finished-agent resume: --server mode's AgentRuntime generates its own internal sessionId independently of the outer session/logDir cli.ts uses for DhServer's logger. So log headers in --server mode already didn't match their directory before DH-0003, pre-existing and out of that ticket's scope. Needs its own investigation into where the two sessionId sources diverge and which one (if either) is authoritative.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
