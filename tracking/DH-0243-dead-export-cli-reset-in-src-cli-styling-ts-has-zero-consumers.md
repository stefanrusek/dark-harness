---
spile: ticket
id: DH-0243
type: bug
status: verifying
owner: Core
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0241]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0243: Dead export: CLI_RESET in src/cli/styling.ts has zero consumers

## Summary

`export const CLI_RESET = Object.freeze(SGR_RESET);` at `src/cli/styling.ts:33` has zero
consumers anywhere in `src/` (production or test). Its own justifying comment (lines 17-19)
claims it is "re-exported (rather than folded away) since help.ts's own section-header
styling composes it directly" — but `help.ts` no longer references `CLI_RESET` (or
`SGR_RESET`) at all; the only live `SGR_RESET` uses are inside `design-tokens.ts`'s own
`wrapSgr`. So both the export and the stale comment that rationalizes it are dead.

`CLI_YELLOW` and `CLI_BOLD` in the same block are used internally; only `CLI_RESET` is
unreferenced. Found during refactoring round 3 (DH-0241).

## User Stories

### As a maintainer, I want no dead exports carrying stale justifications

- Given `src/cli/styling.ts`, when I search the repo for `CLI_RESET`, then the only hit is its own declaration (i.e. it is genuinely unused).
- Given the module comment at lines 17-19, when `CLI_RESET` is removed, then the sentence claiming help.ts composes it is removed with it so no stale rationale remains.
- Given the removal, when the gates run, then typecheck/lint/coverage stay green (nothing depended on it).

## Functional Requirements

- Delete the `CLI_RESET` export at `src/cli/styling.ts:33`.
- Remove the now-orphaned justifying sentence in the module comment (lines 17-19).

## Assumptions

- `CLI_YELLOW`/`CLI_BOLD` remain (they are used); only `CLI_RESET` is removed.

## Risks

- None material — it is unreferenced.

## Open Questions

## Notes

Filed by Fable during refactoring round 3 (DH-0241).

### 2026-07-20

Confirmed `CLI_RESET` had zero consumers outside its own declaration (`grep -rn CLI_RESET
src/ test/` matched only the comment line and the declaration in `src/cli/styling.ts`).
Removed the export and the stale "help.ts's own section-header styling composes it directly"
sentence from the module comment; `CLI_YELLOW`/`CLI_BOLD` untouched. Gates:
typecheck/lint/test:coverage (100%, 146/146)/e2e (41/41) all green. Moving to `verifying`.
