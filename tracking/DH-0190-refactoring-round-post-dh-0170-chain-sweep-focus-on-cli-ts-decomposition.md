---
spile: ticket
id: DH-0190
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

# DH-0190: Refactoring round: post-DH-0170-chain sweep, focus on cli.ts decomposition

## Summary

Second refactoring round (DH-0141 mechanism). Scoped to commits since the last Refactoring-Round trailer (DH-0169's closing commit), covering the whole DH-0170 client-core decomposition chain (DH-0183-0186), DH-0171/0172/0173/0176/0177/0178/0179/0180/0181, DH-0168/0182 (host/port flags), and DH-0187/0188/0189 (--import feature). Owner has explicitly asked this round give extra attention to src/cli.ts (2041 LOC pre-this-round, most-churned file in the repo per DH-0169's findings) as a standing priority, not just a routine finding among others: decomposing it would help readability, churn (it is the file that changes most often, so it is a merge-conflict/review hotspot), editability, and testability. DH-0174 (split cli.ts + extract shared ANSI primitive, filed in the first round) should be reviewed for whether its scope is still accurate/current after this round's changes (DH-0168/0182/0189 all added new cli.ts flag-parsing code) and extended if further decomposition opportunities are found beyond what it already captures.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
