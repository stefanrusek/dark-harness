---
spile: ticket
id: DH-0209
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0175]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0209: Sub-agents may lack access to ReportOutcome, falling back to TASK_FAILED confusion

## Summary

Manual testing finding (2026-07-19): in two separate sub-agent test runs, the sub-agent appeared to not know about/have access to the ReportOutcome tool for final status reporting, and failed looking for a nonexistent tool. Needs verification: is ReportOutcome actually registered for sub-agents (not just the root), and if so why did the model behave as if it wasn't available -- could be a prompt-teaching gap (relates to DH-0175's finding that ReportOutcome is registered but never taught in the system prompt) rather than a tool-registration bug. Needs investigation before a fix is scoped.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
