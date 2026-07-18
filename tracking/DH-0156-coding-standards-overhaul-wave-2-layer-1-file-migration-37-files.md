---
spile: ticket
id: DH-0156
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0155]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0156: Coding-standards overhaul Wave 2: layer-1 file migration (37 files)

## Summary

Second wave of Fable's leaf-to-root dependency-tree migration plan. These 37 files depend only on Wave 1 files (now final), so they're safe to migrate now. Per file: classify as .type.ts, .constant.ts, needs an import.meta.main guard, or already compliant. Update every importer of any renamed file (including any Wave 1 import paths these files reference, which are now final). Split into 7 directory-clustered sub-waves (2A-2G) per Fable's dispatch breakdown, dispatched in parallel since files within a wave have no edges between them.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
