---
spile: ticket
id: DH-0155
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0154]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0155: Coding-standards overhaul Wave 1: leaf-layer file migration (60 files, layer 0)

## Summary

First wave of Fable's leaf-to-root dependency-tree migration plan. These 60 files have zero internal src/ dependencies (true leaves), so they're safe to migrate first and in parallel -- no importer needs updating except each file's own external importers, which live in later waves and haven't been touched yet. Per file: classify as .type.ts (types/interfaces only), .constant.ts (constants + derived types only), needs an import.meta.main guard (has an unconditional top-level call), or already compliant (no change). Update every importer of any renamed file. Split into 9 directory-clustered sub-waves (1A-1I) per Fable's dispatch breakdown, dispatched in parallel since files within a wave have no edges between them.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
