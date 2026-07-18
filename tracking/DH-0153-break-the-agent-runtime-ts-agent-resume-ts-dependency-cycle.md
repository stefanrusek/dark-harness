---
spile: ticket
id: DH-0153
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0153: Break the agent/runtime.ts <-> agent/resume.ts dependency cycle

## Summary

Fable's dependency-graph analysis for the coding-standards overhaul found one real cycle in src/: runtime.ts imports reconstructSubAgentHistory from resume.ts, while resume.ts imports ROOT_AGENT_ID (a constant) from runtime.ts. This blocks assigning runtime.ts a stable layer in the leaf-to-root wave plan and must be broken before wave 5 (which contains runtime.ts). Fix: extract ROOT_AGENT_ID (and any sibling agent-id constants) into a new src/agent/agent-id.constant.ts, imported by both runtime.ts and resume.ts. Clean, self-justifying example of the overhaul's own value -- a pure-data constant embedded in an orchestration file was the entire cause of the cycle.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
