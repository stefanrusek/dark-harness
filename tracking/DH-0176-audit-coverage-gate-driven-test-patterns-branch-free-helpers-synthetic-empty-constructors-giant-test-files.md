---
spile: ticket
id: DH-0176
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

# DH-0176: Audit coverage-gate-driven test patterns (branch-free helpers, synthetic empty constructors, giant test files)

## Summary

Multiple code artifacts exist only to satisfy the 100% coverage gate rather than to test behavior.

## Domain / owner

Cross-cutting (agent/tools tests, server, web) — coordinator triage

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

Several artifacts exist **only** to satisfy the 100% coverage gate rather than to exercise
behavior:
- `src/agent/tools/test-helpers.ts:1-2` is a written admission — "Kept branch-free so it
  doesn't dilute the 100%-coverage gate."
- Synthetic empty constructors carried in production modules purely so Bun's coverage
  instrumentation marks a constructor slot "hit": `src/web/client/sse.ts:106-107` and
  `src/server/fake-agent-loop.ts:33-34` (each with a `biome-ignore noUselessConstructor`).
- The very large `runtime.test.ts` (~2740 lines) and `loop.test.ts` (~2171 lines) are big
  enough to likely contain line-hitting tests rather than focused behavior tests (flagged
  by size only — not read in full).

**FLAGGED FOR ESCALATION (CLAUDE.md §5 / §6 item 1):** the 100%-coverage gate is a locked
quality gate. Anything that would *weaken* it is architect/owner territory, NOT a routine
refactor. The safe, in-scope cleanups are: fix the Bun synthetic-constructor instrumentation
quirk once (config/exclusion) instead of sprinkling `constructor(){}`, and replace
coverage-shaped test infra with behavior-shaped tests **without lowering the gate**. Relates
to DH-0149 (per-file process isolation changes how coverage is collected).

