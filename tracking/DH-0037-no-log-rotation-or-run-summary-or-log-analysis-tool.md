---
spile: ticket
id: DH-0037
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0037: No log rotation/disk-growth caps, no structured final run-summary artifact, and no log-analysis tooling

## Summary

`.dh-logs/` grows without any rotation, size cap, or cleanup of old session directories — a
long-lived host running many jobs, or one very long session with verbose tool output, accumulates
disk usage indefinitely with nothing to prune it. Separately, the standalone `--instructions --job`
path's only output is a free-text final message plus an exit code — no `summary.json` (cost, turn
count, duration, agent count, final status) is written for a downstream orchestrator to consume
without parsing free text or reconstructing from raw JSONL. And despite HANDOFF §7's own framing
that the header-line design exists "so a tool reading only first lines across all files can
reconstruct the complete timeline and agent tree," no such tool actually ships — an operator
answering "what did it cost, where is it stuck, did it loop" today can only do so by manually
`jq`-ing through potentially many JSONL files by hand.

## User Stories

### As an operator running `dh` unattended for a long time, I want disk usage to not grow without bound

- Given repeated or long-running sessions, when `.dh-logs` grows, then a rotation/prune policy
  (max total size, max age) is available, even if the default remains "operator manages it."

### As an orchestrator consuming a finished job's results, I want a machine-readable summary, not just free text

- Given a completed `--job` run, when it finishes, then a `summary.json` (final status, cost, turn
  count, duration, agent count) is written into the session's log directory alongside the JSONL.

### As an operator, I want a CLI tool that reconstructs the agent tree/cost/status from a session's log headers

- Given a session's `.dh-logs/<id>/` directory, when `dh logs <sessionDir>` (or similar) is run,
  then it prints the agent tree with per-agent status/cost/duration, without hand-authored `jq`.

## Notes

> [!NOTE]
> Source: dark-factory ops audit findings #7, #12, #13.

> [!NOTE]
> Owner decision (2026-07-15): queue now. **Sequencing note:** this ticket's `summary.json`
> story overlaps with DH-0050's already-designed `job_result`/`ReportOutcome` mechanism (see
> that ticket's architect design) — implement this ticket's `summary.json` piece *after*
> DH-0050's Core round lands, reusing its field shapes rather than inventing a parallel one.
> Log rotation and the `dh logs` analysis tool are independent of that sequencing and can
> start immediately.

> [!NOTE]
> Coordinator audit (2026-07-16): confirmed log rotation (`src/server/log-retention.ts`) and
> the `dh logs` analysis tool (`src/server/log-analysis.ts`, `src/cli.ts`'s `logs` subcommand)
> are both fully implemented and shipped. `summary.json` remains unimplemented, still blocked
> on DH-0050 (`job_result`/`ReportOutcome`), which is itself still `status: ready`. Ticket
> correctly stays `implementing` — 2 of 3 user stories done, third genuinely blocked, not
> forgotten.

> [!NOTE]
> Grace (2026-07-16): DH-0050 has landed and closed — `src/contracts/outcome.ts`'s
> `ReportedOutcome`/`JobResultLine` shapes and `src/agent/loop.ts`'s `AgentLoopResult.
> outcome`/`reportedBy` are the real, shipped field shapes to reuse for `summary.json`
> (`success`, `turns`, `outcome` in particular — DH-0050's own design text already commits to
> those names matching). This ticket's `summary.json` piece is unblocked; not implemented
> here (out of this round's scope per DH-0050's own boundary note).

> [!NOTE]
> Grace (2026-07-16): implemented `summary.json` — `src/server/summary.ts` writes
> `success`/`turns`/`outcome`/cost/duration/agent-count into the session's log directory when
> a `--job` run finishes, reused via `src/cli.ts` and `src/server/index.ts`. Verified with
> `bun run typecheck`, `bun run lint` (9 pre-existing errors, all in unrelated
> `.claude/skills/forked-subagent/` files, none touching this change), and `bun test src`
> (1964 pass, 0 fail). Full `bun run e2e` intentionally not re-run this round (change doesn't
> touch `e2e/`, and the suite is slow) — commit `1f3d6a2`. All three user stories now have
> shipped code; moving to `verifying` for close-out test-name verification per §9.
