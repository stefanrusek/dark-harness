---
spile: ticket
id: DH-0154
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0151, DH-0152, DH-0153]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0154: GritQL custom lint rule: enforce .type.ts/.constant.ts export restrictions and no-side-effects-at-module-scope

## Summary

Part of the coding-standards overhaul (dependency-tree wave plan by Fable). Now that DH-0151 landed Biome 2.5.4 (which added GritQL-based custom lint plugin support), write .grit pattern(s) under a plugins/ directory referenced in biome.json's plugins array enforcing the three standing rules: (1) .type.ts files may only export types/interfaces, no runtime values; (2) .constant.ts files may only export constants plus types derived from those constants via typeof/keyof typeof (not arbitrary types); (3) every other non-test src .ts/.tsx file may only export types, functions, or classes, with no other code at module/global scope except exactly one call gated behind an import.meta.main-style guard. Scope out test files (*.test.ts(x)), .d.ts files, and (per owner decision) do not touch the noBarrelFile/noExportedImports question -- barrels stay as-is. Land the rule at 'warn' severity initially so it doesn't block the in-flight wave-based file migration; flip to 'error' only after all waves are merged (separate follow-up ticket/task).

## User Stories

### As the lint gate, I want the three standing export rules enforced mechanically at warn severity

- Given a `.type.ts` file with a non-type export, when `bun run lint` runs, then it's flagged
  — proven via throwaway fixtures (`good.type.ts` clean, `bad.type.ts` flagged), deleted after.
- Given a `.constant.ts` file with a computed (non-literal) const or an arbitrary standalone
  type, when `bun run lint` runs, then it's flagged — proven the same way.
- Given any other non-test `src/` file with top-level code beyond type/interface/function/class
  declarations and imports/exports (excluding one `import.meta.main`-guarded call), when
  `bun run lint` runs, then it's flagged at `warn` — proven against the real tree (270
  warnings, all genuine: pre-existing module-level `const`s to migrate in future waves, plus
  one real ungated side effect in `test-dom.ts`).
- Given the whole rule set, when `bun run lint` runs, then it still exits 0 (warnings don't
  fail the build) — proven directly.

## Functional Requirements

1. Three `.grit` files under `plugins/`: `type-file-restrictions.grit`,
   `constant-file-restrictions.grit`, `no-module-scope-side-effects.grit`.
2. Wired into `biome.json`'s `plugins` array, each scoped via `includes` globs
   (`**/src/**/...` convention, matching the existing `overrides` entry already in this repo's
   config).
3. All three fire at `severity="warn"` (set per-diagnostic inside each `.grit` file's
   `register_diagnostic(...)` call, not via biome.json).
4. Scoped to exclude `*.test.ts(x)` and `*.d.ts` files.

## Assumptions

## Risks

- The 270 current warnings must all be resolved (via the wave-based migration) before the
  rule can be flipped to `error` (task 8/final step) — until then this is advisory only.

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Implemented and merged. Key GritQL gotchas worked through: `export const x = ...`
> parses as `JsExport(export_clause=$c)` wrapping `JsVariableDeclarationClause`, not a directly
> matchable `JsVariableStatement` — every rule needs a parallel exported-form branch. TS-level
> `typeof X` is `TsTypeofType`, not the JS-expression snippet form. `includes` globs need a
> leading `**/` to match (bare `src/**/*.ts` matched nothing). "Not nested in a function/class
> body" is `not $s <: within JsFunctionBody()`, uniform across function/arrow/method bodies.
>
> Verified: rules 1/2 via throwaway fixtures (good/bad pairs for each), deleted before commit.
> Rule 3 run against the real tree: 270 warnings — 265 pre-existing module-level `const`s
> across ~30+ files (spot-checked `src/cli.ts`'s `DEFAULT_PORT` and color constants — genuine,
> exactly what the wave migration will move into `.constant.ts`), plus 4 side-effect + 1
> if-statement finding, all in `src/web/client/test-dom.ts` (genuine ungated module-scope
> side effect installing `globalThis.window`/`document` — a known, pre-existing case, not a
> new bug). `bun run lint` exits 0 (zero errors, 270 warnings). `bun run typecheck` clean.
> `bun run test:coverage` 125/125 (99.75%, unaffected).
