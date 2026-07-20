---
spile: ticket
id: DH-0159
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0158]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0159: Coding-standards overhaul Waves 5-9: root-layer file migration + entrypoint guards (11 files)

## Summary

Final 5 waves of Fable's leaf-to-root dependency-tree migration plan, dispatched sequentially (each layer depends on the prior, unlike waves 1-4 which had internal sub-wave parallelism): wave 5 (4 files: config/index.ts, server/index.ts, tui/ink/App.tsx, web/client/components/App.tsx), wave 6 (3 files: agent/resume.ts, tui/ink/mount.ts, web/client/app.ts), wave 7 (2 files: tui/app.ts, web/client/main.ts -- the latter already import.meta.main-guarded from earlier DH-0149 work), wave 8 (1 file: tui/index.ts), wave 9 (1 file: cli.ts, the root entrypoint). Also folds in scripts/test-isolated.ts's own unguarded top-level await main() call, flagged by Fable's original dependency-graph analysis.

## User Stories

### As the coding-standards overhaul, I want the entrypoint layer verified guard-compliant and the migration completed

- Given `src/cli.ts` (the production root entrypoint), when audited, then its single
  top-level bootstrap call is confirmed already correctly wrapped in
  `if (import.meta.main) { await main(); }`, and no other top-level side-effecting
  statements exist anywhere in the file — proven by a line-by-line audit of every top-level
  statement.
- Given `scripts/test-isolated.ts`'s own unguarded `await main()` (the one remaining item
  Fable's original analysis flagged), when guarded, then the orchestrator still runs
  identically when invoked directly — proven by a full `test:coverage` run, 125/125
  unchanged.
- Given every other file across layers 4-7 (`config/index.ts`, `server/index.ts`, both
  `App` composites, `resume.ts`, `mount.ts`, `app.ts`, `tui/index.ts`), when classified,
  then each correctly stays regular or (for `tui/index.ts`) is confirmed already a
  side-effect-free pure barrel.

## Functional Requirements

- No renames were warranted anywhere in waves 5-9 — every file has real logic or is already
  correctly structured (mount.ts/app.ts's render calls only fire inside exported functions,
  never at module scope; `web/client/main.ts`'s guard from earlier DH-0149 work confirmed
  intact; `cli.ts`'s guard confirmed already correct).
- Only change: `scripts/test-isolated.ts`'s top-level `await main()` -> guarded.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: All 5 waves (5-9) complete, dispatched sequentially per their strict
> dependency ordering. Zero file renames across the entire tail — every file was either
> already compliant or (mount.ts/app.ts/cli.ts) already correctly avoided unconditional
> module-scope execution from earlier work this session. Guarded
> `scripts/test-isolated.ts`'s `await main()` as the one real remaining fix, verified the
> orchestrator runs identically afterward.
>
> Process note: one sub-wave agent (Wave 8) incorrectly reported its stale worktree as
> "already up to date" without actually verifying (its own lint/test output format
> contradicted the claim). Caught by independently verifying the target file directly on
> the real branch rather than trusting the report — the file itself (`tui/index.ts`, a
> 2-line pure re-export) made the staleness immaterial to the actual conclusion. Wave 9's
> prompt was written with this failure mode explicitly called out and instructed the agent
> to concretely verify (check installed Biome version, confirm lint doesn't config-error)
> rather than trust a surface-level check — it did so correctly.
>
> This closes DH-0149's entire dependency-tree migration plan (waves 1-9, ~143 files
> reviewed, 12 total renames: 5 contracts files, `agent/tools/types.ts`, `terminal.ts`,
> `prompt/banner.ts`, `server/agent-loop.ts`, `tui/types.ts` split into 2 files). Remaining
> before the overhaul's stated goal ("lint must have no warnings or errors") is complete:
> flip DH-0154's GritQL rule from `warn` to `error` and confirm zero warnings repo-wide.
