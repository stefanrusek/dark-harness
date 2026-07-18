---
spile: ticket
id: DH-0151
type: feature
status: implementing
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

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
