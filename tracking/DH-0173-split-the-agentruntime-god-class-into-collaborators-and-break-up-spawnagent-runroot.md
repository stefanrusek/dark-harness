---
spile: ticket
id: DH-0173
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

### 2026-07-18 — implemented and closed

Behavior-preserving refactor of `src/agent/runtime.ts` (Core domain). Public `AgentRuntime`
surface verified unchanged by grepping `src/server/` and `src/cli.ts` usage before touching
anything; only private internals were restructured, method signatures are byte-identical.

New collaborator modules under `src/agent/`:

- `model-overrides.ts` — pure `AgentLoopParams` override helpers (pricing/thinking/cache/
  context-window/compaction), moved verbatim.
- `model-registry.ts` — `ModelRegistry` class: model-alias resolution + per-provider-name
  provider caching. `ConfigModelError` now lives here, re-exported from `runtime.ts` for
  import compatibility.
- `session-budget.ts` — `SessionBudget` class: cumulative cost/token bookkeeping and
  cap-crossing detection (DH-0013). `AgentRuntime` still owns reacting to a trip (it holds
  the task registry/root state needed to stop every live agent).
- `worktree-registry.ts` — `WorktreeRegistry` class: DH-0077 isolation-worktree lifecycle
  (reserve/get/release + concurrency budget).
- `skills-cache.ts` — `SkillsCache` class: DH-0093's eager `discoverSkills()` scan.
- `mcp-tools-merge.ts` — `mergeMcpTools()` standalone function (was a private method).

`spawnAgent` (~256 lines) decomposed into an orchestrator plus `checkFanoutBudget()`,
`reserveWorktreeIfRequested()`, `runSubAgent()`, `settleSubAgentWorktree()`. `runRoot`
(~244 lines) decomposed into an orchestrator plus `resolveRootModel()`,
`reportRootStartFailure()`, `reportRootLoopFailure()`, `startWallClockBudgetIfNeeded()`,
`runRootLoop()`, `finalizeRootRun()`.

All four CLAUDE.md §5 gates green:

- `bun run typecheck` — clean (tsc --noEmit x3 project configs).
- `bun run lint` — `Checked 348 files in 74ms. No fixes applied.`
- `bun run test:coverage` — `2205 pass, 4 skip, 0 fail`; 100.00% line coverage on
  `runtime.ts` and every new collaborator file (`worktree-registry.ts` shows <100% funcs%
  but 100.00% lines, which is the gated metric per CLAUDE.md §5).
- `bun run e2e` — `38 pass, 0 fail` (real compiled binary, PTY + headless browser + mock
  provider).

Note re: CLAUDE.md §9 — this ticket's User Stories section was left as "to be written at
refining" (never advanced past `draft`) and this close skips that step per explicit
dispatcher instruction; it is a pure internal refactor with no new user-facing behavior, so
no new Given/When/Then acceptance criteria applied. Existing `runtime.test.ts` coverage
(now split across the new collaborator test files) is what proves behavior preservation.

Commit: `7366c38` — "DH-0173: split AgentRuntime into collaborators, decompose
spawnAgent/runRoot" (local to worktree branch `claude/coordinator-onboarding-kab9ls`, not
pushed).

