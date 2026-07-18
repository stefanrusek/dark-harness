---
spile: ticket
id: DH-0157
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0156]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0157: Coding-standards overhaul Wave 3: layer-2 file migration (21 files)

## Summary

Third wave of Fable's leaf-to-root dependency-tree migration plan. These 21 files depend only on Wave 1/2 files (now final). Includes the tui/types.ts mixed type+constant standout (needs an actual split decision, per DH-0149's earlier partial backfill) and server/agent-loop.ts (a known type-only contract file from DH-0149's coverage backfill work, strong .type.ts candidate). Split into 5 directory-clustered sub-waves (3A-3E) per Fable's dispatch breakdown, dispatched in parallel.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
