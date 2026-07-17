---
spile: ticket
id: DH-0113
type: feature
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

# DH-0113: Coordinator gate checks should be a checked-in sub-agent prompt, not run inline

## Summary

Owner directive (2026-07-16, Slack): stop running gates inline as coordinator. Write a strict, checked-in gate-check prompt file that a dispatched sub-agent runs given a worktree path + ticket number (it fetches the ticket itself, runs the real gate commands, reports pass/fail). This never got built — coordinator has been running gates inline all session. Owner: prioritize at the same level as tests, put at the top of the queue once dispatch unfreezes.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
