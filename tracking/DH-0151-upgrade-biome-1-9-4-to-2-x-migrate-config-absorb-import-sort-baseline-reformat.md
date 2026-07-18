---
spile: ticket
id: DH-0151
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0151: Upgrade Biome 1.9.4 to 2.x, migrate config, absorb import-sort baseline reformat

## Summary

Bump @biomejs/biome from 1.9.4 to 2.x. Run 'biome migrate --write' to convert biome.json (files.ignore -> files.includes with negation globs, overrides[].include -> includes, linter.rules.recommended -> rules.preset). Then run 'biome check --write' once to absorb the new import-organizer's sort reformat (the dominant source of new findings, ~92 of them, all mechanical) plus ~26 genuine new recommended-rule findings (noDelete, noImportantStyles, noTemplateCurlyInString, noUnusedImports, noUnusedFunctionParameters, useConst, noArrayIndexKey, noUnsafeOptionalChaining, noDescendingSpecificity, noUnusedPrivateClassMembers), all auto-fixable or trivial per Fable's own dry-run against this repo. This is the prerequisite for DH-0149-overhaul's GritQL custom lint rule work (Biome's plugin system, which lets custom rules be written as .grit pattern files instead of full Rust plugins, only landed in 2.0). Land this first so the GritQL rule work builds on a clean 2.x baseline, not a moving target.

## User Stories

### As the project's lint gate, I want zero errors and zero warnings on Biome 2.x

- Given the upgraded config and reformatted tree, when `bun run lint` runs, then it reports
  zero errors and zero warnings — proven directly by running it.

## Functional Requirements

1. `@biomejs/biome` bumped 1.9.4 -> 2.5.4 in `package.json`, `bun.lock` updated.
2. `biome.json` migrated via `biome migrate --write` (schema bump, `files.ignore` ->
   `files.includes` negation globs, `overrides[].include` -> `includes`,
   `linter.rules.recommended` -> `rules.preset`).
3. Import-sort reformat and all auto-fixable findings absorbed via `biome check --write`.
4. Remaining non-auto-fixable findings fixed by hand (see Notes for the one real regression
   caught along the way).

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Implemented and merged. `bun run lint` confirmed at zero errors/zero warnings
> (346 files checked). Manual fixes: stale `biome-ignore` comments removed (rules no longer
> trigger under 2.x), `noUnsafeOptionalChaining` fix in `web-search.test.ts`, `noArrayIndexKey`
> fix in `ErrorLogPanel.tsx` (added a monotonic `id` field to `ErrorLogEntry` since
> timestamp+message alone could collide), `noDescendingSpecificity`/`noImportantStyles` in
> `styles.css`.
>
> **Real regression caught and fixed**: `biome check --write --unsafe`'s autofix stripped
> `!important` from `.hidden` and the `prefers-reduced-motion` block in `styles.css`, which
> broke e2e — a hidden `.model-picker-overlay` kept intercepting clicks because a
> same-specificity, later-in-source rule (`display: flex`) won without `!important`. Restored
> with per-declaration `biome-ignore` comments explaining why it's load-bearing. Caught via
> full e2e rerun before treating the upgrade as done — exactly why "run --write and call it
> done" isn't sufficient for a mechanical-looking reformat.
>
> Verified: `bun run typecheck` clean, `bun run test:coverage` 125/125 (99.75%, matching
> pre-upgrade baseline), `bun run e2e` 38/38 (after the CSS fix; the 3 failures seen mid-work
> were the real regression above, not a separate issue).
>
> Two files (`src/agent/mcp/__fixtures__/fixture-coverage.test.ts`,
> `src/tui/types.test.ts`) needed a follow-up import-order fix after merging into the
> coordinator's branch — they landed (via other in-flight tickets) after this upgrade's
> worktree had already branched, so Biome 2.x's stricter import organizer hadn't seen them
> yet. Trivial, folded into the merge commit.
