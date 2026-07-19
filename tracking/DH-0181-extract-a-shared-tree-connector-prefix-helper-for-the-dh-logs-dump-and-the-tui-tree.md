---
spile: ticket
id: DH-0181
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0181: Extract a shared tree-connector prefix helper for the dh logs dump and the TUI tree

## Summary

server/log-analysis.ts formatNode and tui/tree.ts flattenTree compute identical box-drawing prefixes; tree.ts already documents that it mirrors formatNode.

## Domain / owner

Cross-domain: Server (log-analysis) + TUI (tree) — small

## User Stories

- Given `dh logs`'s offline session dump and the TUI's interactive agent tree, when either
  renders a node's row, then both derive the box-drawing connector (`""`/`"└─ "`/`"├─ "`) and
  the prefix contribution for descendants (unchanged/`"   "`/`"│  "`) from one shared pure
  function instead of duplicating the logic — proven by
  `src/contracts/tree-connector.test.ts` (`treeConnector`, `treeChildPrefix` cases covering
  root, last-child, and non-last-child branches).
- Given the existing `dh logs` and TUI tree test suites, when the shared helper is wired in,
  then rendered output is byte-for-byte unchanged — proven by the pre-existing
  `src/server/log-analysis.test.ts` and `src/tui/tree.test.ts` (and TUI e2e tree-rendering
  coverage) continuing to pass unmodified against the refactored call sites.

## Notes

Filed by Fable during refactoring round DH-0169.

`src/server/log-analysis.ts:211-224` (`formatNode`) and `src/tui/tree.ts:20-28`
(`flattenTree`) compute the identical box-drawing prefix (`isLast ? "└─ " : "├─ "`, child
prefix `isLast ? "   " : "│  "`); tree.ts:12 already says it "Mirrors `formatNode`." The
connector-string derivation is pure and identical and should be one helper feeding both the
offline `dh logs` dump and the interactive tree. Small but clean; spans two domains, so
slice/assign deliberately.

### 2026-07-18 — implemented

Extracted `treeConnector(isRoot, isLast)` and `treeChildPrefix(isRoot, prefix, isLast)` into
a new `src/contracts/tree-connector.ts` (pure, no wire-schema dependency; placed there as
the existing shared cross-domain location both `src/server/log-analysis.ts` and
`src/tui/tree.ts` already import from — a lighter call than inventing a new top-level `util/`
directory for two call sites). Both `formatNode` (log-analysis.ts) and `flattenTree`
(tree.ts) now call the shared helper instead of re-deriving the connector glyphs inline; the
`isRoot` check keeps each site's own root-detection convention (`prefix === ""` for
log-analysis, `depth === 0` for tree.ts).

Added `src/contracts/tree-connector.test.ts` covering root/last/non-last branches for both
functions — 100% line/function coverage on the new file. No behavior change: existing
`src/server/log-analysis.test.ts` and `src/tui/tree.test.ts` pass unmodified.

All four quality gates green locally: `bun run typecheck`, `bun run lint`, `bun run
test:coverage` (2182 pass, 100% coverage on touched files), `bun run e2e` (38 pass).

