---
spile: ticket
id: DH-0174
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0191]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0174: Split cli.ts (2041 lines) into focused modules and extract a shared ANSI/color primitive

## Summary

The most-churned largest file mixes arg-parsing, help rendering, ANSI theming, env-file parsing, and a runtime adapter; ANSI escapes are independently redefined in 8 files.

## Domain / owner

Core — src/cli.ts (Grace); shared ANSI touches TUI/Server

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169; concrete
decomposition plan added by DH-0190, 2026-07-19)._

## Scope refresh — DH-0190 (2026-07-19)

This ticket was filed against a 2041-line cli.ts. As of round DH-0190 the file is **2297
lines** — it grew again this round via DH-0168/DH-0182 (`--web-port`/`--host` flags) and
DH-0189 (`--import` + `--model`), all of which piled new code into `parseArgs` (now ~130
lines with four separate cross-flag validation blocks) and `main()`. That churn *confirms
rather than dilutes* the ticket's premise: the flag-parsing surface is the single hottest
merge-conflict/review hotspot in the repo and is the highest-value extraction target.

**One scope change:** the "shared ANSI/color primitive" cross-domain sub-item that used to
live in this ticket's Notes has been **split out into DH-0191** and reframed, because
`src/design-tokens.ts` (DH-0137) — which post-dates this ticket — now already exists as the
canonical shared status-color table, changing that fix from "build a primitive" to "migrate
the two stragglers onto the one that exists." This ticket is now scoped **purely to the
single-domain (Core) cli.ts split**; DH-0191 owns the cross-domain SGR consolidation. The two
couple only at `src/cli/styling.ts` (see plan step 3 / DH-0191).

## Concrete decomposition plan (DH-0190)

Target: a `src/cli/` submodule directory (all Core-owned — `src/cli.ts` and its subtree stay
under Core per CLAUDE.md §3), with `src/cli.ts` reduced to a thin barrel + `main()`
orchestrator. **Hard constraint:** `cli.ts` must **re-export every symbol the test suite and
e2e currently import from it** (`parseArgs`, `composeMode`, `RunMode`, `CliOptions`,
`renderHelpText`, `parseEnvFile`, `buildStartupPostureNote`, `ActivityFeed`,
`AgentRuntimeLoopAdapter`, `resolveImportSource`, `buildResumeNotice`, `formatDoctorReport`,
`SAMPLE_DH_JSON`, `DEFAULT_PORT`, `CliUsageError`, `CliDeps`, `main`, …) so the split is
**test-neutral** — no test rewrites, which matters under the 100%-coverage gate. Tests keep
importing from `../src/cli.ts`; the barrel forwards.

Extraction targets (current line ranges in the 2297-line file), each a focused module:

1. **`src/cli/styling.ts`** (~lines 469-530, 483-520) — the CLI SGR palette (`CLI_GREEN`…
   `CLI_RESET`), `cliColorize/cliDim/cliBold/cliSuccessGlyph/cliCautionGlyph/cliStatusDot`,
   `CLI_STATUS_COLOR`. The one genuinely shared leaf — imported by help/doctor/init/
   activity-feed/run-interactive. **Extract first.** Its *internals* are the coupling point
   with DH-0191 (which later repoints them at `design-tokens.ts`); don't re-duplicate.
2. **`src/cli/args.ts`** (~lines 89-149, 619-770) — `CliOptions`, `FLAGS_WITH_VALUES`,
   `parseArgs`, `RunMode`, `composeMode`. Pure flag parsing + mode composition + all four
   cross-flag validation blocks (`--json`/`--web-port`/`--model`/`--import` mutual exclusion).
   **Highest-churn concentration → biggest editability/conflict win.** `parseArgs` calls
   `composeMode`, so keeping both here avoids a cross-module cycle.
3. **`src/cli/help.ts`** (~lines 229-467) — `HELP_*` constants, `HelpItem`, `renderHelpText`,
   `renderHelpSection`, `renderHelpItemTwoColumn/SingleColumn`, `helpColumns`,
   `helpNameStyle/helpSectionHeader`. Self-contained; imports `wrapText` (already a direct
   cross-domain import from `src/tui/width.ts`) + `styling.ts`.
4. **`src/cli/env-file.ts`** (~lines 847-916) — `parseEnvFile`, `unescapeDoubleQuoted`,
   `readEnvFile`. Pure dotenv-subset parser, already fully unit-covered.
5. **`src/cli/import-source.ts`** (~lines 772-845) — `resolveImportSource`. Pure filesystem
   path-kind detection; the only Core-side piece of the `--import` feature (the translator
   itself is Server's `import-claude-session.ts`).
6. **`src/cli/activity-feed.ts`** (~lines 532-617) — `ActivityFeed`, `buildStartupPostureNote`,
   `printAppHeader`. `--server`-mode operator output.
7. **`src/cli/doctor.ts`** (~lines 1642-1873) — `DoctorResult`, `DOCTOR_*` constants,
   `formatDoctorRow/formatDoctorPendingRow/formatDoctorReport`, `runDoctor`. Self-contained
   subcommand.
8. **`src/cli/init.ts`** (~lines 152-227, 1564-1640) — `SAMPLE_DH_JSON`, `runInit`.
   Self-contained subcommand (byte-for-byte README-synced sample config).
9. **`src/cli/agent-loop-adapter.ts`** (~lines 918-1214) — `AgentRuntimeLoopAdapter`,
   `createStandaloneRuntime`. The Core↔Server bridge (~300 lines).
10. **`src/cli/deps.ts`** (~lines 1058-1275) — `CliIo`, `CliDeps`, `DhServerLike`,
    `WebUiHandleLike`, `defaultDeps`, `fail`. The dependency-injection seam that every mode
    runner and every test's `main(argv, overrides)` call depends on.
11. **`src/cli/run.ts`** (~lines 1277-1912) — `buildResumeNotice`, `runInteractiveMode`,
    `runDryRun`. The mode-dispatch bodies.

After extraction, **`src/cli.ts`** keeps only: the DH-0164 first-import side-effect line, the
barrel re-exports, and `main()` (~lines 1914-2296) — the top-level subcommand routing
(`logs`/`--help`/`--version`/`init`/`doctor`), env/config/systemPrompt loading, the
`--import`→`--resume` fold, resume resolution, and dispatch into the mode runners. Estimated
~300 lines, down from 2297.

**Landing order (leaf-first, to minimize churn per step; each is independently green):**
styling → env-file → import-source → help → doctor → init → activity-feed → agent-loop-adapter
→ deps → run → slim `main`/barrel. May be one ticket with ordered commits or several — a
coordinator sequencing call.

**Cycle avoidance:** keep the DI *types* (`CliDeps`/`CliOptions`/`RunMode`) in their leaf
modules (`deps.ts`/`args.ts`) so runners import types without pulling `main`; `cli.ts` is the
only aggregator that imports everything. `deps.ts` → `agent-loop-adapter.ts` is the one real
runtime edge, and it's acyclic.

## Notes

Filed by Fable during refactoring round DH-0169. Independently corroborated by the
coordinator's own scan: `src/cli.ts` was the **single most-churned file in the repo**
(49 revisions) and the largest source file (2041 lines; now 2297).

Concrete decomposition plan and scope refresh added by Fable during round DH-0190
(2026-07-19), per that round's owner-directed priority on cli.ts. The cross-domain
ANSI/SGR sub-item that previously lived here now lives in **DH-0191** (see Scope refresh).

