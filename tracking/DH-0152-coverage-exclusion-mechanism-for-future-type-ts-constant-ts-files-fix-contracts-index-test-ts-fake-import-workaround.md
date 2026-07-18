---
spile: ticket
id: DH-0152
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0149, DH-0150]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0152: Coverage-exclusion mechanism for future .type.ts / .constant.ts files, fix contracts/index.test.ts fake-import workaround

## Summary

Part of the coding-standards overhaul (dependency-tree wave plan by Fable). Wire the DH-0150 custom lcov merge (and/or gate.yml's completeness check) to skip *.type.ts / *.constant.ts glob patterns entirely once those suffixes exist, rather than relying on value-level fake-import workarounds like the current src/contracts/index.test.ts (whose sole purpose is forcing coverage registration for otherwise-untested type-only files, and which is now unnecessary now that DH-0150's merge preserves LF:0 SF: records). Must land before any wave of the overhaul actually renames a file to .type.ts or .constant.ts, or the coverage gate breaks for those files. Exact mechanism (Bun coverage config, or a gate.yml/orchestrator-side filter) not yet decided -- this ticket is to design and implement it.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
