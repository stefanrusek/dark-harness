---
spile: ticket
id: DH-0163
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

# DH-0163: Coverage backfill: close the pre-existing ~30-line gap across 12 files (99.76% -> 100%)

## Summary

Real, pre-existing coverage gap (99.76%, 13034/13066 lines), confirmed stable across multiple local runs and matching real CI's number, unrelated to the coding-standards overhaul (DH-0150-0162, which only fixed the coverage MEASUREMENT accuracy, not pre-existing gaps). Files with uncovered lines per the latest coverage/lcov.info: src/agent/loop.ts (670/671), src/agent/mcp/__fixtures__/fake-stdio-server-discovery-fails.ts (20/21), src/agent/mcp/__fixtures__/fake-stdio-server.ts (37/38), src/agent/tools/bash.ts (129/130), src/agent/tools/test-helpers.ts (27/28), src/agent/tools/web-fetch.ts (247/248), src/cli.ts (1048/1052), src/config/validate.ts (566/567), src/markdown/rendering-fixtures.ts (246/248), src/tui/app.ts (160/172), src/tui/ink/App.tsx (36/41), src/tui/state.ts (566/568). Note: tui/app.ts and tui/ink/App.tsx's gaps may be entangled with DH-0146's render-timing bug (uncovered branches could be exactly the ones DH-0146's flaky assertions never reach) -- coordinate sequencing with that ticket, may partially resolve itself once DH-0146 is fixed rather than needing separate test-writing.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
