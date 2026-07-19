---
spile: ticket
id: DH-0183
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0183: Establish src/client-core/ and consolidate the zero-coupling shared client primitives (slash-command parser + ConnectionStatus vocabulary)

## Summary

Create a new shared client-implementation directory src/client-core/ (architect-approved ownership decision from DH-0170) and move the two byte-identical, UI-agnostic primitives into it: the slash-command parser (src/tui/commands.ts == src/web/client/slash-commands.ts) and the ConnectionStatus vocabulary (src/tui/connection-status.constant.ts == the union in src/web/client/state.ts). These are shared CLIENT logic/vocabulary, not wire truth, so they do NOT belong in src/contracts/. Foundation for the SSE-transport extraction (sibling sub-ticket).

## User Stories

### As Core (Grace), I want the slash-command parser deduplicated, so TUI and Web can never silently drift on the command grammar

- Given `src/tui/commands.ts` and `src/web/client/slash-commands.ts` were byte-identical
  implementations, when DH-0183 lands, then both files are deleted and a single module,
  `src/client-core/slash-command-parser.ts`, is the sole implementation, exercised by
  `src/client-core/slash-command-parser.test.ts` (merged from the two former test files,
  which were also byte-identical). Proven by: `src/client-core/slash-command-parser.test.ts`
  (`parseSlashCommand`, `isBuiltinCommandName` describe blocks).
- Given `src/tui/state.ts` and `src/web/client/app.ts` previously imported their own local
  parser, when DH-0183 lands, then both import `parseSlashCommand` from
  `../client-core/slash-command-parser.ts` (Web: `../../client-core/...`), and existing
  TUI/Web behavior is unchanged. Proven by: `src/tui/state.test.ts` and
  `src/web/client/app.test.ts` (pre-existing suites, unmodified, still passing against the
  new import).

### As Core (Grace), I want the `ConnectionStatus` vocabulary declared once, so TUI and Web can't drift on the four-state union

- Given `src/tui/connection-status.constant.ts` and a local union in
  `src/web/client/state.ts` declared the identical `"connecting" | "live" | "reconnecting" |
  "disconnected"` vocabulary independently, when DH-0183 lands, then the canonical
  declaration (`CONNECTION_STATUSES` + derived `ConnectionStatus` type) lives in
  `src/client-core/connection-status.ts`, the TUI constant file is deleted, and
  `src/web/client/state.ts` re-exports the type from `client-core` instead of declaring its
  own. Proven by: `src/client-core/connection-status.test.ts` (moved/adapted from the former
  `src/tui/connection-status.constant.test.ts`).
- Given TUI modules (`src/tui/sse-client.ts`, `src/tui/types.type.ts`) and Web modules
  (`src/web/client/sse.ts`, `format.ts`, `components/ConnectionPill.tsx`, and their tests)
  consume `ConnectionStatus`, when DH-0183 lands, then every consumer still type-checks and
  passes against the new single source (TUI imports directly from `client-core`; Web
  consumers keep importing from `./state.ts`, which now re-exports the `client-core` type).
  Proven by: `bun run typecheck` (zero errors across root/`src/web`/`src/tui` tsconfigs) and
  the full `bun run test:coverage` run (all pre-existing TUI/Web suites green).

### As the Coordinator, I want `src/client-core/` recorded as an owned directory, so future agents don't guess who owns shared client logic

- Given CLAUDE.md §3's ownership map had no row for shared client-implementation code, when
  DH-0183 lands, then a `src/client-core/` row exists, owned by **Core**, describing its
  scope (shared client primitives, not wire truth) and citing DH-0170's architect
  pre-approval for the ownership decision. Proven by: `CLAUDE.md` §3 (manual inspection —
  documentation content has no automated test, per the project's own convention for prose
  ownership-map entries).

## Functional Requirements

- `src/client-core/` exists as a new top-level directory, sibling to `src/contracts/`, for
  shared client-side *implementation* (not wire schema).
- `src/client-core/slash-command-parser.ts` is the single implementation of the slash-command
  grammar (`parseSlashCommand`, `BUILTIN_COMMAND_NAMES`, `isBuiltinCommandName`,
  `ParsedSlashCommand`), replacing `src/tui/commands.ts` and
  `src/web/client/slash-commands.ts` (both deleted).
- `src/client-core/connection-status.ts` is the single implementation of the `ConnectionStatus`
  vocabulary (`CONNECTION_STATUSES`, `ConnectionStatus`), replacing
  `src/tui/connection-status.constant.ts` (deleted) and the local union previously declared in
  `src/web/client/state.ts` (now a type re-export of the `client-core` type).
- All prior importers (TUI: `state.ts`, `sse-client.ts`, `sse-client.test.ts`,
  `types.type.ts`; Web: `app.ts`, `state.ts`) are updated to import from `src/client-core/`
  (directly, or transitively via `state.ts`'s re-export for existing Web consumers of
  `ConnectionStatus`), with no behavior change.
- `CLAUDE.md` §3 gains a `src/client-core/` ownership row (Core/Grace), per DH-0170's
  pre-approval of this ownership decision.
- All four CLAUDE.md §5 quality gates pass: `bun run typecheck`, `bun run lint`,
  `bun run test:coverage` (100% coverage maintained), `bun run e2e`.

## Assumptions

- DH-0170's architect decomposition (Fable, 2026-07-18) already settled that this content is
  shared client vocabulary/logic, not wire truth, and does **not** belong in
  `src/contracts/` — no fresh architect sign-off was sought for this ticket beyond that
  pre-approval, per the coordinator's instruction.

## Risks

- None realized. The two source pairs were confirmed byte-identical before merging, so this
  was a pure move/dedup with no behavioral decision to make (unlike the SSE-transport
  validation-strictness divergence flagged in DH-0170/DH-0184, which does not apply here).

## Open Questions

None.

## Notes

### 2026-07-18 — Implementation and gate verification

Implemented as scoped: created `src/client-core/slash-command-parser.ts` (+ `.test.ts`) and
`src/client-core/connection-status.ts` (+ `.test.ts`); deleted the six superseded files
(`src/tui/commands.ts`, `src/tui/commands.test.ts`, `src/tui/connection-status.constant.ts`,
`src/tui/connection-status.constant.test.ts`, `src/web/client/slash-commands.ts`,
`src/web/client/slash-commands.test.ts`); updated every importer; added the `src/client-core/`
row to CLAUDE.md §3.

Gate results (local, 2026-07-18):
- `bun run typecheck` — clean (root + `src/web` + `src/tui` tsconfigs).
- `bun run lint` — clean (`biome check .`, 360 files, no fixes needed).
- `bun run test:coverage` — 128/128 test files pass, 100.00% line coverage (13142/13142).
- `bun run e2e` — 38/38 pass on a clean run. One transient failure
  (`e2e/web.test.ts`'s `dh --web` headless-browser test, a `stream.getReader()` TypeError in
  `e2e/support/dh-process.ts`) was observed once under full-suite parallel execution but
  reproduced as a pass both in isolation and on a subsequent full-suite rerun — pre-existing
  test-infra flakiness (binary-spawn/stream-teardown timing under contention), not caused by
  this ticket's changes (no e2e file touches `client-core`, `commands.ts`, or
  `connection-status`).
