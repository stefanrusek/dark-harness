# ADR 0006: Exit code contract for `--job` mode

**Status:** Accepted

## Context

`dh --job` is meant to be driven by external orchestration (CI, a dark-factory scheduler)
that needs to distinguish "the agent tried and failed the task" from "the harness itself
broke" without parsing logs.

## Decision

With `--job`, the process exits when the root agent finishes its instructions:

- **`0`** — root agent completed and self-reported success.
- **`1`** — root agent self-reported task failure.
- **`2+`** — harness error (crash, provider/auth failure, bad config, etc.). Specific
  non-zero values beyond 2 may be assigned per error class as the harness matures; `2` is
  the floor/catch-all, not a single specific meaning.

Without `--job`, the process stays alive after completion for inspection (TUI/web still
attached).

## Consequences

- The root agent must have a defined, machine-readable way to self-report success/failure
  that the server maps to exit code 0/1 — this is part of the agent-loop contract
  (`src/agent/`), not just a CLI-layer decision.
- Harness-error exit codes (2+) must not be reused for task-outcome signaling — callers
  branch on "0 or 1 = the agent ran to completion" vs "2+ = something above the agent layer
  broke" as the first-order distinction.
- E2E coverage must assert all three exit-code classes for `--job` mode.

## Amendment (DH-0059, 2026-07-15): interactive `session_ended` exitCode semantics

Interactive sessions (server/TUI/Web — `interactive: true` in `src/agent/loop.ts`) don't go
through the `--job` self-report path above, but they do carry an `exitCode` on their
`session_ended` SSE event, computed from the same `AgentLoopResult.success` boolean via
runtime.ts's `result.success ? Success : TaskFailure` mapping. This amendment clarifies what
`success` means for the three distinct "stopped by operator" points in `loop.ts`
(`STOPPED_BETWEEN_TURNS_REASON`, `STOPPED_DURING_PROVIDER_CALL_REASON`,
`STOPPED_WHILE_WAITING_REASON`):

- Stopping an agent **paused in "waiting"** status (between turns, already completed a turn
  with no tool call, idle until the operator's next message or a stop) is a **graceful end
  of the conversation**, not an interrupted task — `success: true`, `exitCode: 0`.
- Stopping an agent **actively working** — between turns but mid-conversation
  (`STOPPED_BETWEEN_TURNS_REASON`) or mid-provider-call (`STOPPED_DURING_PROVIDER_CALL_REASON`)
  — remains an interruption of real work — `success: false`, `exitCode: 1`, unchanged.

No new exit code is introduced; this only assigns a semantic to which existing code (0 vs 1)
an operator-initiated stop of an interactive session reports, based on whether the agent was
idle or busy at the moment it was stopped. See
`tracking/DH-0059-interactive-root-agent-never-reaches-session-ended-without-an-explicit-stop.md`
for the full design.
