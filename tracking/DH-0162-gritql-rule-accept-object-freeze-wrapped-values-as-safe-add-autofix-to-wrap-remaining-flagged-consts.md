---
spile: ticket
id: DH-0162
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0161]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0162: GritQL rule: accept Object.freeze()-wrapped values as safe, add autofix to wrap remaining flagged consts

## Summary

Owner decision, generalizing beyond the new Set()/Map() case DH-0161's pilot found: any top-level const/let initializer that is not already a primitive literal or an as-const literal must be wrapped in Object.freeze(...) to be considered safe -- this covers new Set([...]), new Map([...]), plain object/array literals without as-const, and any other non-obviously-inert expression, uniformly, without needing per-pattern special-casing in the rule. Critically: implement this as a GritQL autofix (rewrite), not just a diagnostic, so 'bunx biome check --write .' mechanically wraps every remaining flagged top-level value in Object.freeze(...) across all ~55 still-flagged files in one pass, rather than requiring file-by-file manual triage like DH-0161's pilot did for config/validate.ts. Verify Object.freeze()'s actual runtime semantics are acceptable for this use (it does NOT deep-freeze or prevent Set/Map internal mutation via .add()/.delete() -- only prevents reassigning/reconfiguring the const binding's own object properties -- confirm this is still an acceptable safety signal for the rule's purpose, or flag if it's not, before treating this as done).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
