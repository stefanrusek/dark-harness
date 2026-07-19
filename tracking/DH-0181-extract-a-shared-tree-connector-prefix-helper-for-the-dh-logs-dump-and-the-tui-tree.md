---
spile: ticket
id: DH-0181
type: bug
status: draft
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

# DH-0181: Extract a shared tree-connector prefix helper for the dh logs dump and the TUI tree

## Summary

server/log-analysis.ts formatNode and tui/tree.ts flattenTree compute identical box-drawing prefixes; tree.ts already documents that it mirrors formatNode.

## Domain / owner

Cross-domain: Server (log-analysis) + TUI (tree) — small

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

`src/server/log-analysis.ts:211-224` (`formatNode`) and `src/tui/tree.ts:20-28`
(`flattenTree`) compute the identical box-drawing prefix (`isLast ? "└─ " : "├─ "`, child
prefix `isLast ? "   " : "│  "`); tree.ts:12 already says it "Mirrors `formatNode`." The
connector-string derivation is pure and identical and should be one helper feeding both the
offline `dh logs` dump and the interactive tree. Small but clean; spans two domains, so
slice/assign deliberately.

