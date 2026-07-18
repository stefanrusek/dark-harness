---
spile: ticket
id: DH-0152
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0149, DH-0150]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0152: Coverage-exclusion mechanism for future .type.ts / .constant.ts files, fix contracts/index.test.ts fake-import workaround

## Summary

Part of the coding-standards overhaul (dependency-tree wave plan by Fable). Wire the DH-0150 custom lcov merge (and/or gate.yml's completeness check) to skip *.type.ts / *.constant.ts glob patterns entirely once those suffixes exist, rather than relying on value-level fake-import workarounds like the current src/contracts/index.test.ts (whose sole purpose is forcing coverage registration for otherwise-untested type-only files, and which is now unnecessary now that DH-0150's merge preserves LF:0 SF: records). Must land before any wave of the overhaul actually renames a file to .type.ts or .constant.ts, or the coverage gate breaks for those files. Exact mechanism (Bun coverage config, or a gate.yml/orchestrator-side filter) not yet decided -- this ticket is to design and implement it.

## User Stories

### As the coverage gate, I want files matching `*.type.ts`/`*.constant.ts` to be structurally excluded from coverage tracking, not merely accidentally invisible

- Given a source file named `*.type.ts` or `*.constant.ts`, when `bun run test:coverage` runs,
  then it produces no `SF:`/`DA:`/`LF:`/`LH:` records at all in `coverage/lcov.info` — proven
  by a throwaway fixture file created, tested, and confirmed absent from the merged output.
- Given the same excluded file, when `gate.yml`'s completeness check runs, then it is not
  flagged as "missing" — proven by extracting and running the completeness check's shell logic
  locally against a tree containing the fixture.

## Functional Requirements

1. `scripts/test-isolated.ts`'s `mergeLcov` gained `isExcludedFromCoverage(file)` (checks the
   `.type.ts`/`.constant.ts` suffix) and skips matching files entirely in the merge loop.
2. `.github/workflows/gate.yml`'s completeness-check `ALL_SRC` pipeline gained
   `grep -vE '\.(type|constant)\.ts$'` so excluded files aren't diffed against `SF:` records as
   missing.
3. `src/contracts/index.test.ts`'s fake-import workaround is left unchanged for now (see Notes)
   — becomes moot once those 4 files are actually renamed to `.type.ts` in a future wave.

## Assumptions

- No real `.type.ts`/`.constant.ts` files exist yet in the codebase (the wave-based migration
  creates them later) — this ticket builds the mechanism ahead of that migration.

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Implemented and verified. Proof used a throwaway `src/agent/__scratch.type.ts` +
> matching test file (deleted before commit): confirmed absent from `coverage/lcov.info` and
> not flagged by the completeness check's extracted shell logic. `bun run typecheck`/`lint`
> clean; `bun run test:coverage` unchanged at 99.75% (13029/13061), 125/125 tests — identical
> to the pre-change baseline (one run hit a known flaky 124/125 from test-contention issues
> already documented in `gate.yml`'s comments; a clean rerun passed 125/125).
>
> **Judgment call on `contracts/index.test.ts`:** temporarily narrowed its import to bypass the
> barrel and reran coverage — `commands.ts`/`config.ts`/`events.ts`/`log.ts` still appeared as
> `SF:` records (`LF:0`/`LH:0`), because other source files elsewhere already transitively
> import them and are exercised by their own tests. So the file's own comment ("sole purpose is
> forcing coverage registration") is no longer literally true — it's currently redundant. Left
> unchanged rather than removed: it's still the only *explicit, test-owned* guarantee against
> those 4 files silently dropping out of coverage-completeness if some future refactor removes
> the transitive import chain elsewhere. Removing it now trades an explicit safety net for an
> implicit, undocumented one, which isn't clearly justified before those files are actually
> renamed to `.type.ts` (at which point this ticket's exclusion mechanism makes the whole
> question moot by construction).
