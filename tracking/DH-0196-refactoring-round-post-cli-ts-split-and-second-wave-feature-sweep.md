---
spile: ticket
id: DH-0196
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0196: Refactoring round: post-cli.ts-split and second-wave feature sweep

## Summary

Third refactoring round (DH-0141 mechanism). Scoped to commits since DH-0190's closing trailer commit, covering: DH-0132 (dh --job acceptance-test prototype), DH-0142/0143/0144 (slash-command autocomplete + skill listing, new src/client-core/command-list.ts), DH-0147/0148 (--job output-mode matrix + --instructions auto-send), DH-0194 (--job prompt awareness), DH-0174 (cli.ts split into 11 src/cli/ modules, redone fresh against current HEAD), DH-0191 (SGR/status-color consolidation onto design-tokens.ts, folded into the cli.ts split), plus README updates (CI badge, new-flag documentation via DH-0195) and DH-0192/0193's design exploration. Several of these landed via careful merge-agent reconciliation of stale worktrees against a fast-moving cli.ts -- worth checking for any residual seams (leftover comments referencing old file locations, inconsistent module boundaries) now that the dust has settled.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
