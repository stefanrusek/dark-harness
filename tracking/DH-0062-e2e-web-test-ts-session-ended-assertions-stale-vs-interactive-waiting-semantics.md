---
spile: ticket
id: DH-0062
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0061]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0062: e2e/web.test.ts session-ended assertions stale vs interactive waiting semantics

## Summary

Found while executing DH-0061's spikes against a real Chromium (2026-07-15, Fable): after one completed turn in dh --web, the root agent pauses at status 'waiting' (Core Round 5 interactive semantics) with a Stop button and no session banner. e2e/web.test.ts still waits for data-status 'done', a 'Done' badge, and the 'Session ended — success (exit 0)' banner — so it will hang/fail on any machine that actually has Chromium. It has been silently stale behind the missing-Chromium sandbox gap every round since the semantics changed. Fix mirrors Hedy Round 2's server-protocol fix: wait for agent_status 'waiting' (or drive an explicit stop) instead of session end. Owner: E2E (Hedy).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
