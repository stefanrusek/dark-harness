---
spile: ticket
id: DH-0155
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0154]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0155: Coding-standards overhaul Wave 1: leaf-layer file migration (60 files, layer 0)

## Summary

First wave of Fable's leaf-to-root dependency-tree migration plan. These 60 files have zero internal src/ dependencies (true leaves), so they're safe to migrate first and in parallel -- no importer needs updating except each file's own external importers, which live in later waves and haven't been touched yet. Per file: classify as .type.ts (types/interfaces only), .constant.ts (constants + derived types only), needs an import.meta.main guard (has an unconditional top-level call), or already compliant (no change). Update every importer of any renamed file. Split into 9 directory-clustered sub-waves (1A-1I) per Fable's dispatch breakdown, dispatched in parallel since files within a wave have no edges between them.

## User Stories

### As the coding-standards overhaul, I want all 60 leaf-layer files correctly classified and migrated

- Given each of the 60 layer-0 files, when classified against the standing rules, then it
  either becomes `.type.ts`, `.constant.ts`, or stays a regular file (with an
  `import.meta.main` guard if it had an unconditional top-level call) — proven by 9
  sub-wave agents' file-by-file classification, each independently verified via
  `bun run lint`'s GritQL rule output before/after.
- Given the whole migrated wave, when `bun run typecheck`/`lint`/`test:coverage`/`e2e` run,
  then nothing regresses — proven directly (see Notes).

## Functional Requirements

- Renamed: `contracts/{commands,config,events,log}.ts` -> `.type.ts`,
  `contracts/exit-codes.ts` -> `.constant.ts` (sub-wave 1A); `agent/tools/types.ts` ->
  `.type.ts` (1C); `terminal.ts` -> `.constant.ts` (1E); `prompt/banner.ts` -> `.constant.ts`
  (1F).
- Left unchanged (correctly disqualified, mixed exports or real logic): everything in 1B, 1D,
  1G, 1H; `contracts/outcome.ts` (1A — has standalone types not derived from its constant);
  `design-tokens.ts` (1E — same pattern, types not derived from constants); all React
  components and Tool-descriptor files across every sub-wave.
- `web/client/test-dom.ts` (1I): kept its established DOM-globals-at-module-load design
  (14+ dependent test files rely on the bare-import side effect), given a
  `biome-ignore-all` with reasoning instead of a risky cross-file refactor — the one
  standout Fable's plan anticipated.
- `contracts/index.test.ts`'s fake-import-for-coverage rationale removed (dead per DH-0152),
  its one real assertion (barrel re-export smoke test) kept.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: All 9 sub-waves (1A-1I) complete and merged. Final state: `bun run typecheck`
> clean, `bun run lint` exits 0 (259 warnings, down from 270 baseline — only files with a
> real top-level const before renaming reduced the count, since pure-type files never
> triggered the rule to begin with), `bun run test:coverage` 125/125 (99.75%, one flaky
> failure on first run, clean on rerun — consistent with documented pre-existing test
> contention), `bun run e2e` 35/38 (3 failures identical to the pre-existing local-only
> `--connect --web` timing flake confirmed multiple times earlier this session via
> `git stash` comparison, not a regression).
>
> Process note: several sub-wave worktrees branched before DH-0151/0152/0153/0154 landed and
> needed a rebase/merge onto the current branch tip before starting (flagged by 1A, 1C, 1D,
> 1I's own reports) — not an error, just normal drift when dispatching many parallel agents
> against a fast-moving branch. One sub-wave agent (1F) briefly `cd`'d into the shared main
> checkout by mistake mid-task, caught and reverted immediately, no lasting effect (confirmed
> via `git status` on the main checkout both before and after).
