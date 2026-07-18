---
spile: ticket
id: DH-0156
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0155]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0156: Coding-standards overhaul Wave 2: layer-1 file migration (37 files)

## Summary

Second wave of Fable's leaf-to-root dependency-tree migration plan. These 37 files depend only on Wave 1 files (now final), so they're safe to migrate now. Per file: classify as .type.ts, .constant.ts, needs an import.meta.main guard, or already compliant. Update every importer of any renamed file (including any Wave 1 import paths these files reference, which are now final). Split into 7 directory-clustered sub-waves (2A-2G) per Fable's dispatch breakdown, dispatched in parallel since files within a wave have no edges between them.

## User Stories

### As the coding-standards overhaul, I want all 37 layer-1 files correctly classified

- Given each of the 37 layer-1 files, when classified against the standing rules, then each
  correctly stays a regular file (all 37 turned out to have real logic/mixed exports
  disqualifying them from `.type.ts`/`.constant.ts`) — proven by 7 sub-wave agents'
  independent file-by-file review.
- Given the whole wave, when `bun run typecheck`/`lint`/`test:coverage` run, then nothing
  regresses (trivially true — zero files changed).

## Functional Requirements

- No renames were warranted anywhere in this wave. Every file — Tool implementations
  (2A/2B/2C), provider adapters/managers (2D), the `contracts/index.ts` barrel + server/prompt
  utilities (2E), TUI state/utilities (2F), web components/utilities (2G) — has real logic
  (functions, classes) alongside any types/constants it exports, correctly disqualifying it
  from the leaf-file suffix rules.
- `contracts/index.ts`'s barrel re-exports verified correct against Wave 1's renames
  (`commands.type.ts`, `config.type.ts`, `events.type.ts`, `exit-codes.constant.ts`,
  `log.type.ts`, `outcome.ts` unchanged) — no edits needed, already correct from Wave 1's
  own importer updates.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: All 7 sub-waves (2A-2G) complete. Zero file changes across the entire wave —
> every layer-1 file correctly stays regular. This is an expected, valid outcome (Fable's
> plan never guaranteed every wave would contain renames, just that leaves-first ordering
> makes classification safe). `bun run typecheck` clean, `bun run lint` exits 0 (259
> warnings, unchanged from Wave 1's end state since nothing here qualified). Several
> sub-wave agents hit known test-contention flakiness on first `test:coverage` runs
> (different files each time — MCP timeout tests, web app-composer tests), all confirmed
> clean on rerun, consistent with the documented pre-existing pattern.
