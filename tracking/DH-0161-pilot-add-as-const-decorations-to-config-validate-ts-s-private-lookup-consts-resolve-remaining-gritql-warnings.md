---
spile: ticket
id: DH-0161
type: bug
status: verifying
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

### As the pilot, I want to know precisely what as-const alone can and can't resolve before scaling

- Given `config/validate.ts`'s 14 flagged consts, when as-const-based fixes are attempted,
  then all 14 clear, but only some via pure decoration — proven and reported honestly (see
  Notes for the breakdown by case).

## Functional Requirements

- Plain array/object literals without `as const`: add `as const` directly, trivial.
- Bare top-level `new Set([...])`: `as const` on the array alone does NOT clear the warning
  (empirically confirmed) — required a real Set-to-array rewrite (`.has()` -> `.includes()`)
  for all 11 such cases in this file.
- `Record<T, Set<string>>` object literal containing nested `new Set()` values: wrapping the
  *whole* object in `as const` cleared it — a rule blind spot (doesn't recurse into nested
  `new Set()` calls), not a real fix for the nested Sets themselves.

## Assumptions

## Risks

- Scaling the Set-to-array rewrite to the ~55 remaining flagged files repeats a real (if
  low-risk) semantic change file by file, rather than a single well-scoped rule extension.

## Open Questions

- Whether to scale this exact approach to the remaining files, or extend the GritQL rule to
  recognize `new Set(...)`/`new Map(...)` over an already-literal-safe argument as safe —
  open, routed back to the owner given the pilot's finding.

## Notes

> [!NOTE]
> 2026-07-18: Pilot complete. `config/validate.ts`: 14 warnings -> 0. Repo-wide: 112 -> 98.
> `bun run typecheck` clean, `bun run test:coverage` 125/125 (99.75%), unaffected.
>
> Key finding worth weighing before scaling: the `new Set([...])` case is the dominant
> remaining pattern across the other ~55 files. It cannot be resolved by decoration alone —
> every instance needed an actual Set->array rewrite, verified safe here only because each
> was a small (1-11 element) allowlist checked via `.has()` in a non-hot config-load path.
> Repeating this ~50+ more times is real, if low-risk, work — an alternative is extending
> `no-module-scope-side-effects.grit` to recognize "constructor call whose sole argument is
> already literal-safe" as inert (true fact: `new Set(["a","b"])` has zero side effects
> regardless of whether the rule currently recognizes it). Not decided; routed to the owner.
