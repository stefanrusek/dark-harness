---
spile: ticket
id: DH-0160
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0154]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0160: Refine no-module-scope-side-effects GritQL rule: allow private consts with literal/as-const initializers

## Summary

DH-0154's no-module-scope-side-effects.grit currently flags ANY top-level const/let statement in a regular (non-.constant.ts) file, exported or not -- producing 258 warnings across ~30+ files that mix real logic with private, non-exported top-level constants (e.g. 'const MAX_RETRIES = 3' sitting above the function that uses it). Owner decision: loosen the rule to allow unexported top-level consts whose initializer is a literal/immutable value -- implicitly-const primitives (const x = 5) or object/array literals with an 'as const' assertion (const y = {} as const) -- since these carry zero import-order/side-effect risk (the actual bug class this rule exists to prevent, per DH-0145/test-dom.ts/main.ts, was always about executed/computed values or exported mutable state, never inert private literals). Consts whose initializer involves a function call, computation, 'new', or a non-const-asserted object/array literal should still be flagged regardless of export status. This is a prerequisite for flipping the rule from warn to error (the final step of the coding-standards overhaul, DH-0159's closing note) -- flipping now would hard-fail the build on all 258 pre-existing warnings, most of which are exactly this safe-literal-const pattern.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
