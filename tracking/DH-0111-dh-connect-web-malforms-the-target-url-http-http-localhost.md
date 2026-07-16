---
spile: ticket
id: DH-0111
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0111: dh --connect --web malforms the target URL (http://http://localhost...)

## Summary

Found live while verifying DH-0110's fix: dh --connect <host> --web's connection pill gets stuck on Connecting... never reaches Live, while dh --web works cleanly with the identical asset-loading fix. Traced to src/cli.ts malforming the connect target URL as a doubled scheme (http://http://localhost:...) rather than a real bug in the just-fixed asset routing. Not yet investigated further -- filed for tracking, not dispatched (owner asked to pause new dispatches 2026-07-16).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
