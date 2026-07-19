---
spile: ticket
id: DH-0173
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

# DH-0173: Split the AgentRuntime God class into collaborators and break up spawnAgent/runRoot

## Summary

runtime.ts is a ~1250-line class owning a dozen concerns, with two methods over 240 lines each.

## Domain / owner

Core — src/agent/runtime.ts (Grace)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

`AgentRuntime` (`src/agent/runtime.ts:231-1486`) is a ~1250-line class owning unrelated
concerns: budgets/cost tracking, worktree lifecycle, MCP tool merging, skills cache,
provider caching, model resolution, SSE/log emission, agent-tree depth maps, and root
lifecycle — with roughly a dozen `private readonly` maps declared at 239-341. Two single
methods are oversized: `spawnAgent` (682-938, ~256 lines) and `runRoot` (938-1182, ~244
lines). runtime.ts is also the repo's 2nd-most-churned source file (33 revisions), so the
concentration of state actively raises the blast radius of every change.

Prime extraction candidates: a budget/cost tracker, a worktree registry, and the MCP-merge
step as injected collaborators; then decompose `spawnAgent`/`runRoot` into named phases.
Behavior-preserving refactor — no wire or contract change intended.

