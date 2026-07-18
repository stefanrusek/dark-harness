---
spile: ticket
id: DH-0159
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0158]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0159: Coding-standards overhaul Waves 5-9: root-layer file migration + entrypoint guards (11 files)

## Summary

Final 5 waves of Fable's leaf-to-root dependency-tree migration plan, dispatched sequentially (each layer depends on the prior, unlike waves 1-4 which had internal sub-wave parallelism): wave 5 (4 files: config/index.ts, server/index.ts, tui/ink/App.tsx, web/client/components/App.tsx), wave 6 (3 files: agent/resume.ts, tui/ink/mount.ts, web/client/app.ts), wave 7 (2 files: tui/app.ts, web/client/main.ts -- the latter already import.meta.main-guarded from earlier DH-0149 work), wave 8 (1 file: tui/index.ts), wave 9 (1 file: cli.ts, the root entrypoint). Also folds in scripts/test-isolated.ts's own unguarded top-level await main() call, flagged by Fable's original dependency-graph analysis.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
