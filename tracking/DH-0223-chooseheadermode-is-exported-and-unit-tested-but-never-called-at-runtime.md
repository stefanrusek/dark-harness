---
spile: ticket
id: DH-0223
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0220]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0223: chooseHeaderMode is exported and unit-tested but never called at runtime

## Summary

DH-0220 added chooseHeaderMode(isServer,isWeb) to src/cli/header.ts with tests, but src/cli/run.ts branches on the run mode directly and only references chooseHeaderMode in a comment ('exists for the multi-branch local/server case'). It has no runtime caller — a dead abstraction carrying its own 100%-covered tests. Either wire run.ts's header-mode selection through it (single source of truth for A2-vs-B gating) or delete it and its tests. Owner: Core.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
