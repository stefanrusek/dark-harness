---
spile: ticket
id: DH-0013
type: feature
status: ready
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

# DH-0013: No wall-clock, cost/token, or sub-agent fan-out budget — only a turn-count cap exists

## Summary

`options.maxTurns` (default 100) is the *only* safety valve on a running agent — there is no
wall-clock timeout, no cumulative token or dollar-cost budget, and no cap on concurrent/total
sub-agent count or nesting-driven fan-out. `computeCostUsd` computes cost for display only, never
compared against a threshold to stop a run. A runaway or looping agent (tool-call loop, repeated
failed edits, or a buggy prompt that spawns `Agent` in a loop) can burn arbitrary compute/spend or
fork-bomb sub-agents with nothing to stop it, which matters acutely for the unattended,
no-human-watching dark-factory use case.

## User Stories

### As an operator, I want to cap total spend/tokens for a run so a runaway loop can't burn unbounded budget

- Given `options.maxCostUsd` or `options.maxTokens` set in `dh.json`, when the cumulative
  total for a session crosses it, then the run stops with a clear, logged reason.

### As an operator, I want to cap wall-clock duration independent of turn count

- Given `options.maxWallClockMs` set, when a session exceeds it, then it stops cleanly rather than
  running indefinitely.

### As an operator, I want to cap total/concurrent sub-agent fan-out

- Given `options.maxConcurrentAgents`/`maxAgentDepth`, when a run would exceed it, then further
  `Agent` spawns are refused with a clear error surfaced to the spawning agent.

## Functional Requirements

- Given any budget is exceeded, when the run stops, then the stop is distinguishable in the JSONL
  log and exit code from a normal completion or an operator-initiated stop.

## Notes

> [!NOTE]
> Source: dark-factory ops audit findings #8 and #19 (confirmed via grep: no `budget`/`timeout`/cap
> construct anywhere in `loop.ts`/`runtime.ts`/`tasks.ts`); Core sweep finding #8 (unbounded
> sub-agent fan-out, noting depth itself is a deliberate invariant per CLAUDE.md §4.8 — only the
> *resource-guard* absence is the gap, not depth itself); Competitive-differentiation sweep finding
> #5 (cost/token budgets) independently raised the same gap.
