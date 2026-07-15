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
