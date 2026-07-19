---
spile: ticket
id: DH-0174
type: bug
status: draft
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

# DH-0174: Split cli.ts (2041 lines) into focused modules and extract a shared ANSI/color primitive

## Summary

The most-churned largest file mixes arg-parsing, help rendering, ANSI theming, env-file parsing, and a runtime adapter; ANSI escapes are independently redefined in 8 files.

## Domain / owner

Core — src/cli.ts (Grace); shared ANSI touches TUI/Server

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169. Independently corroborated by the
coordinator's own scan: `src/cli.ts` is the **single most-churned file in the repo**
(49 revisions) and the largest source file (2041 lines).

It carries at least five separable concerns: help-text rendering (203-414), a private
ANSI palette + glyph helpers (416-472), `ActivityFeed` (508-552), env-file parsing
(655-745, `parseEnvFile`/`unescapeDoubleQuoted`), and the `AgentRuntimeLoopAdapter`
bridge (747-865) — plus `parseArgs`/`composeMode` and the `runInit`/`runDoctor`/`runDryRun`
subcommand handlers. Splitting help-rendering, env-parsing, and the subcommand handlers
into `cli/` submodules would shrink the entrypoint substantially.

**Cross-domain sub-item (flag for coordinator):** ANSI escape sequences are independently
redefined in ~8 files (the private palette here, plus `src/tui/*` and
`src/server/log-analysis.ts`). A shared ANSI/color primitive would serve all three — but
that piece spans Core + TUI + Server and should be sliced deliberately rather than folded
silently into a cli.ts-only refactor.

