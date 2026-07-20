---
spile: ticket
id: DH-0244
type: bug
status: refining
owner: TUI
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

# DH-0244: Byte-identical clearCiEnvForInteractiveInkRender duplicated across two TUI side-effect modules

## Summary

Two TUI side-effect modules carry a byte-identical `clearCiEnvForInteractiveInkRender()`
function plus the same `Object.freeze(...)` module-load-trigger wrapper:

- `src/tui/ink/render-interactive-in-tests.ts:28-41` (DH-0146; the *test* side-effect entrypoint, imported by `src/tui/app.test.ts`)
- `src/tui/ink/clear-ci-env-for-interactive-render.ts:24-37` (DH-0164; the *production* side-effect entrypoint, imported by `src/cli.ts`)

The function bodies are identical (`delete process.env.CI; delete process.env.CONTINUOUS_INTEGRATION; return true;`),
including the identical inline `delete`-not-`= undefined` rationale comment. They differ only
in the exported const name (`ciEnvClearedForInteractiveInkRender` vs
`...InProduction`) and each module's own doc-comment framing.

Two distinct side-effecting module entrypoints are legitimately required (one must be the
*first* import of `cli.ts`; the other is imported by the TUI test before `app.ts`) — that
part is not the problem. The problem is the shared clearing logic is copy-pasted rather than
imported from one place, so a future edit to the mechanism (e.g. if `is-in-ci` starts reading
another env key) must be made in two spots or they silently drift. Found during refactoring
round 3 (DH-0241).

## User Stories

### As a maintainer, I want the CI-env-clearing logic to live in exactly one place

- Given the two side-effect modules, when I inspect the clearing logic, then the `delete process.env.CI` / `delete process.env.CONTINUOUS_INTEGRATION` body exists in exactly one shared function that both modules import.
- Given both existing side-effect entrypoints, when the dedup lands, then both still work as before: `cli.ts`'s first import still clears in production, and `app.test.ts`'s import still clears for the test, with no change to import ordering guarantees.
- Given the dedup, when the gates run, then typecheck/lint/coverage stay green.

## Functional Requirements

- Extract the shared `clearCiEnvForInteractiveInkRender()` body into a single module both side-effect entrypoints import.
- Keep the two distinct side-effecting exports (they encode the two different load-order requirements) — only the inner clearing function is shared.
- Preserve the `Object.freeze` no-module-scope-side-effect lint escape-hatch pattern.

## Assumptions

- The two separate module entrypoints must remain separate for their respective load-order guarantees (cli.ts-first vs before-app.ts-in-test); only the inner logic is deduped.

## Risks

- Import ordering is load-bearing (both modules' comments stress this). The refactor must not add an import indirection that changes when the `delete` actually runs relative to Ink's static import.

## Open Questions

## Notes

Filed by Fable during refactoring round 3 (DH-0241).
