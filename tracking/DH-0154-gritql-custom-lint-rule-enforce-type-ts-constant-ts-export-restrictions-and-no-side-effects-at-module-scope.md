---
spile: ticket
id: DH-0154
type: feature
status: implementing
owner: stefan
resolution:
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

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
