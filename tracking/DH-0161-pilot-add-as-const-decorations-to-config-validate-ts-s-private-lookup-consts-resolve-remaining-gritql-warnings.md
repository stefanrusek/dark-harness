---
spile: ticket
id: DH-0161
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0160]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0161: Pilot: add as-const decorations to config/validate.ts's private lookup consts, resolve remaining GritQL warnings

## Summary

Owner decision: rather than further loosen no-module-scope-side-effects.grit's safe-value definition, fix the actual source files by adding 'as const' to private top-level object/array literal consts (already satisfies DH-0160's existing as-const rule, no rule change needed). Pilot this on src/config/validate.ts (14 warnings, the heaviest remaining file, and it exercises the trickiest case: several consts are 'new Set([...literal strings...])', where the array argument can get 'as const' but the const's own initializer is still a NewExpression, not directly a TsAsExpression -- may need restructuring, e.g. a separate as-const array feeding the Set() call, or may need the rule to also recognize new Set()/new Map() calls whose sole argument is an as-const array/object as safe). Report back precisely what fraction of validate.ts's 14 warnings actually resolve via straightforward as-const additions vs. what needs a different approach, before this gets scaled to the other ~55 files with similar warnings.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
