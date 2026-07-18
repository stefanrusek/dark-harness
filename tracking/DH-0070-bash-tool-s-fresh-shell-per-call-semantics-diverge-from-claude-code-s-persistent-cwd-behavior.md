---
spile: ticket
id: DH-0070
type: bug
status: verifying
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0069]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0070: Agents don't have their own separate working-directory state

## Summary

`AgentRuntime` holds a single, process-wide `cwd` field (set once at construction) shared by
the root agent and every sub-agent it spawns — there is no per-agent cwd concept anywhere in
the code. This is the real, narrower bug worth fixing: not "Bash should persist `cd` across
calls" (dropped — an empirical test against real Claude Code showed it doesn't actually do
that either, even within one agent's own session, so there's no conformance reason to add it,
and it carries real implementation risk — see the old Risks section this replaced). The
actual gap is architectural: nothing gives an agent its own cwd state, inherited from its
parent at spawn time, the way agents already get their own everything else (task id, log
file, conversation history).

## User Stories

### As a sub-agent, I want my own working-directory state, inherited from whichever agent spawned me

- Given a sub-agent is spawned, when its `AgentRuntime`/tool-context wiring is constructed,
  then it captures its own cwd, initialized from its parent's cwd at that moment — not a
  single shared value read by every agent in the process.
- Given this per-agent cwd exists, when Bash runs a command for a given agent, then it uses
  that agent's own cwd, not a global one.

## Functional Requirements

- Give each agent (root and every sub-agent) its own cwd field, captured at spawn time from
  the spawning agent's current cwd — likely threaded through `spawnAgent()`'s params and
  `ToolContext` construction (`src/agent/runtime.ts`, `src/agent/tools/types.ts`).
- This ticket does **not** require Bash to track/update that cwd across calls within one
  agent (i.e., no `cd` persistence) — each Bash call still runs fresh at the agent's cwd,
  exactly as today, just no longer from one shared process-wide value. If a future ticket
  wants cross-call `cd` persistence, it can build on this per-agent field; that's explicitly
  out of scope here.
- Existing tests that assume a single shared cwd need auditing/updating.

## Assumptions

- No `src/contracts/` change needed — purely internal to `AgentRuntime`/`ToolContext`.

## Risks

- None significant — this narrows scope relative to the original ticket specifically to
  avoid the cross-call `cd`-persistence risks (subshells, `&&` chains, background commands)
  that don't apply to a spawn-time-inherited-value fix.

## Notes

> [!NOTE]
> Originally filed 2026-07-16 during the systematic tool-schema/behavior comparison against
> real Claude Code (see DH-0069's Notes for the original framing). First filed as a
> Claude-Code-mirroring mismatch claiming real Claude Code persists `cd` across Bash calls.

> [!NOTE]
> Empirical test (2026-07-16, owner-directed): tested real Claude Code's own Bash tool live —
> a parent agent ran `pwd`, spawned a child that ran `cd /tmp && pwd`, then the parent ran
> `pwd` again (unchanged — confirms a child's `cd` never affects its parent, real per-agent
> isolation). Separately, the parent ran `cd /var && pwd` in one Bash call, then a fresh
> `pwd`-only call immediately after — reverted to the original directory, NOT `/var`.
> **Conclusion: real Claude Code does not persist `cd` across Bash calls even within one
> agent's own session.** The original premise was wrong.

> [!NOTE]
> Owner decision (2026-07-16): rescoped to just the real bug — agents don't have their own
> separate cwd state at all (a single shared `AgentRuntime.cwd`, confirmed in code:
> `spawnAgent()` never gives a sub-agent its own cwd). Dropped the cross-call `cd`-persistence
> feature entirely, since it isn't a conformance requirement (per the empirical test above)
> and isn't something the owner asked for on its own merits either — just fix the isolation
> gap. Ready for implementation as scoped above.

> [!NOTE]
> Implemented 2026-07-16 (Grace, Core domain lead): added a per-agent `agentCwd` map to
> `AgentRuntime` (`src/agent/runtime.ts`) — root's entry seeded in the constructor from
> `this.cwd`, each sub-agent's entry set in `spawnAgent()` from its own parent's entry at
> spawn time. `buildToolContext()` now reads `this.agentCwd.get(agentId)` instead of the old
> single shared `this.cwd` field. No cross-call `cd` persistence added, per this ticket's own
> scope. New test in `src/agent/runtime.test.ts` proves two concurrently-spawned sub-agents
> (from two runtimes with distinct cwds) each see only their own agent's cwd. Gates:
> typecheck/lint clean, `bun test src --coverage` 1390 pass/0 fail with 100% coverage on
> `runtime.ts`, `bun run e2e` 30 pass/2 fail (both pre-existing headless-Chromium-unavailable-
> in-sandbox failures noted by prior rounds, unrelated to this change).

> [!NOTE]
> Regression diagnosed and fixed 2026-07-18 (Fable, architect-on-call). The recurring CI
> failure was **not** a regression of the production DH-0070 fix — that fix is fully intact
> (`agentCwd` map, per-agent capture at spawn time, `buildToolContext` reading it). The
> failure was a **latent test bug** in `runtime.test.ts`'s "each concurrently-spawned
> sub-agent sees its own agent's cwd" test:
>
> - The test set `dirA = realpathSync("/tmp")` and separately chdir'd the process to
>   `tmpdir()`, then asserted the sub-agent's pwd both **equals** `dirA` and **does not
>   equal** `tmpdir()`.
> - On macOS `/tmp` is a symlink to `/private/tmp`, so `realpathSync("/tmp")` (= `/private/tmp`)
>   differs from `tmpdir()` — no contradiction, passes locally.
> - On Linux CI `/tmp` is real and `tmpdir()` returns `/tmp`, so `dirA === tmpdir() === "/tmp"`.
>   The two assertions (`toBe(dirA)` and `not.toBe(tmpdir())`) then directly contradict each
>   other and the test fails — deterministically on Linux, never on macOS. This matches the
>   "CI-only, never reproduces locally" signature, but the cause was platform-dependent path
>   resolution in the test fixtures, not any timing/scheduling race.
>
> Fix: use three genuinely-distinct freshly-created `mkdtemp` directories (one per runtime,
> one the process chdir's into) so no fixture can collide with another on any platform, and
> assert against the real process dir (`procDir`) instead of `tmpdir()`. Production code
> untouched. Local: typecheck/lint clean, target test passes; full `runtime.test.ts` +
> `app.test.ts` green across repeated runs.
>
> **CI-CONFIRMED (2026-07-18, PR #10 run 29643738877):** the runtime.test.ts DH-0070 cwd
> failure is GONE in real GitHub Actions CI — it no longer appears in the failure set. This
> regression is closed. (That CI run still fails on a SEPARATE, pre-existing 99.76% coverage-gate
> gap unrelated to this ticket — see DH-0146's notes.)
