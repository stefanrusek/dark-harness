---
spile: ticket
id: DH-0163
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0163: Coverage backfill: close the pre-existing ~30-line gap across 12 files (99.76% -> 100%)

## Summary

Real, pre-existing coverage gap (99.76%, 13034/13066 lines), confirmed stable across multiple local runs and matching real CI's number, unrelated to the coding-standards overhaul (DH-0150-0162, which only fixed the coverage MEASUREMENT accuracy, not pre-existing gaps). Files with uncovered lines per the latest coverage/lcov.info: src/agent/loop.ts (670/671), src/agent/mcp/__fixtures__/fake-stdio-server-discovery-fails.ts (20/21), src/agent/mcp/__fixtures__/fake-stdio-server.ts (37/38), src/agent/tools/bash.ts (129/130), src/agent/tools/test-helpers.ts (27/28), src/agent/tools/web-fetch.ts (247/248), src/cli.ts (1048/1052), src/config/validate.ts (566/567), src/markdown/rendering-fixtures.ts (246/248), src/tui/app.ts (160/172), src/tui/ink/App.tsx (36/41), src/tui/state.ts (566/568). Note: tui/app.ts and tui/ink/App.tsx's gaps may be entangled with DH-0146's render-timing bug (uncovered branches could be exactly the ones DH-0146's flaky assertions never reach) -- coordinate sequencing with that ticket, may partially resolve itself once DH-0146 is fixed rather than needing separate test-writing.

## User Stories

### As the coverage gate, I want exact 100.00% line coverage, closing the pre-existing gap for real

- Given the 12 originally-flagged files, when real tests are written for each genuine gap
  (or dead code is removed after careful verification), then `bun run test:coverage` reaches
  exactly 100.00% — proven by multiple clean runs, 125/125, exit 0.

## Functional Requirements

- 11 of 12 files closed via real test authoring (new assertions covering: a one-shot
  compaction guard, `import.meta.main` entrypoint guards on two MCP fixtures, an `ESRCH`
  fallback path, a default-throw case, delegation passthroughs, a non-object config value,
  a picker empty-selection case, resize/tick paths unblocked by DH-0146's landed fix, and
  `list_skills`/agent/picker view-kind JSX branches).
- One genuinely unreachable line (`web-fetch.ts`'s "link text but falsy href" branch) removed
  after empirical verification (HTMLRewriter's `getAttribute("href")` never returns `""`,
  only `null`) rather than writing an unhittable test.
- `src/markdown/rendering-fixtures.ts`'s last 2 lines were a genuine Bun coverage-measurement
  artifact (confirmed via isolated per-file coverage runs showing the lines don't even appear
  as DA records outside the merge) — not closed by writing more tests, but by fixing the
  underlying mechanism: extended `plugins/no-module-scope-side-effects.grit` to recognize
  regex literals and `new RegExp(...)` as inherently safe (construction is always
  side-effect-free, unlike the mutation that happens during later use), then moved the
  ANSI-stripping regex to a module-level const — evaluated once at import regardless of
  which test touches the file, closing the gap structurally rather than working around the
  measurement.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Complete. Backfilled 11 of 12 originally-flagged files across 3 dispatch rounds
> (first pass: 9 files; second pass, after DH-0146 landed: `tui/app.ts` + `App.tsx`; final
> coordinator pass: the `rendering-fixtures.ts` measurement artifact via a GritQL rule
> extension rather than more test-writing). `bun run test:coverage` reaches exact 100.00%
> (13069/13069 lines), verified clean across multiple runs (the usual test-contention
> flakiness appeared on some runs — MCP timeout tests, unrelated web component tests —
> confirmed pre-existing and unrelated by isolated reruns of the actually-touched files).
> `bun run typecheck`/`lint` both clean. `bun run e2e` 35/38, the same confirmed
> pre-existing local-only `--connect --web` timeout flake documented throughout this session.
>
> As a side effect, the GritQL rule extension also cleaned up 4 now-unnecessary
> `biome-ignore` comments DH-0162 had added as a workaround (3 in `src/tui/mouse.ts`, 1 in
> `src/config/interpolate.ts`) — those regexes no longer need the Object.freeze()-avoidance
> exception since they're now recognized as safe by construction.
