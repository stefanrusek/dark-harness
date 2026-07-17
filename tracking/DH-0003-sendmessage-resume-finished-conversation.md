---
spile: ticket
id: DH-0003
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

# DH-0003: `SendMessage` should resume a finished agent's conversation, not just error cleanly

## Summary

Round 13 fixed the urgent half of a real bug: `SendMessage` to a task that had already
finished used to silently drop the message while falsely reporting delivery. It now errors
loudly instead ("task already finished"). Real Claude Code semantics go further: sending a
message to a completed agent *continues* its conversation with full context intact, rather
than just refusing. That fuller behavior is deliberately out of scope for round 13 and needs
its own design pass.

## User Stories

### As an agent, I want to be able to continue a conversation with a sub-agent after it finished, without losing its context

- Given a sub-agent that has reached a terminal status (`done`/`failed`/`stopped`), when
  `SendMessage` is called on it, then the sub-agent resumes with its full prior conversation
  history intact, rather than the call failing.

## Functional Requirements

- Given a resumed agent, when it produces further output, then that output is attributed to
  the same agent identity/log file as before (no new agent id, no history loss).

## Assumptions

- The underlying loop/task-registry machinery from Round 5 (pause instead of end) and Round
  12 (push notifications) likely provide most of what's needed — this may be a smaller
  follow-on than DH-0002, but needs a real look before committing to that assumption.

## Risks

- None identified yet — needs design work before risks can be assessed properly.

## Open Questions

- ~~Should resuming a `failed`/`stopped` agent behave differently than resuming a `done`
  one?~~ Resolved — see architect note below: no, treated identically.

## Notes

> [!NOTE]
> Current (correct, but partial) behavior: `SendMessage` to a finished task now returns a
> clear error naming it as already finished, rather than silently losing the message. That
> is the fix that already shipped; this ticket is the fuller "actually resume it" behavior.

> [!NOTE]
> Owner decision (2026-07-15): queue for implementation now — matches real Claude Code
> semantics HANDOFF.md requires mirroring. Core's call on the open question (does
> `failed`/`stopped` resume differ from `done`) and on exact TaskRegistry/loop wiring.

> [!NOTE]
> Architect design pass (Fable, 2026-07-16), per owner request to look for refactoring
> opportunity before implementation, not just the minimum feature slice.
>
> **Scope decision: root-only reconstruction, generalized to any agentId — not a bigger
> "reconstruct arbitrary sub-agent trees" effort.** `src/agent/resume.ts`'s own doc comment
> already flags itself as root-agent-only "v1"; the reason it's root-only has nothing to do
> with the agent being root — `foldEventsToMessages` and `readAgentLogLines` are already
> agent-agnostic (`readAgentLogLines(sessionDir, agentId)` takes any id, and `loadHop` calls
> it with `ROOT_AGENT_ID` only because that's the one thing `--resume` needs). The one
> genuinely root-specific piece is `resolveChain()` — walking a session's `resumedFrom`
> chain *across* `.dh-logs/<sessionId>` directories, because `--resume` restarts a whole new
> process/session pointed at an old one. A finished sub-agent SendMessage is targeting has
> no such chain: it lived, ran, and finished entirely inside the *current* session directory.
> So "extend reconstruction to sub-agent granularity" is not the bigger scope it sounds like
> — it's dropping the chain-walk, not adding anything.
>
> **Refactoring proposal — one shared reconstruction primitive, two thin callers:**
>
> 1. In `src/agent/resume.ts`, extract the guts of `loadHop` (open the session dir, read
>    `<agentId>.jsonl`, validate header) plus `foldEventsToMessages` into a single exported
>    function, e.g. `replayAgentHistory(logsRoot: string, sessionId: string, agentId: string):
>    { header: LogHeader; messages: ProviderMessage[] }`. This becomes the one place that
>    turns a JSONL log back into a `ProviderMessage[]` — today that logic exists once, but is
>    only reachable via the root-only, chain-walking `loadResumeSession`, so a second
>    "reconstruct one agent's history" caller would otherwise have had to duplicate
>    `foldEventsToMessages` (the actually nontrivial ~90 lines) verbatim, or import it and
>    still hand-roll the file-open/header-validate wrapper. Neither is acceptable duplication
>    for something this fiddly (dangling-tool_use repair, system-role skipping, etc).
> 2. `loadResumeSession` (the `--resume` path) becomes: `resolveChain()` as today, then call
>    `replayAgentHistory(logsRoot, hop.sessionId, ROOT_AGENT_ID)` per hop and concatenate —
>    same behavior, less code, chain-walking now visibly the *only* thing left in
>    `resume.ts` proper that's root/`--resume`-specific.
> 3. New function alongside it, e.g. `reconstructSubAgentHistory(logsRoot: string, sessionId:
>    string, agentId: string): ProviderMessage[]` — no chain walk (a sub-agent's log never has
>    a `resumedFrom` header; it's not its own session), just one call to
>    `replayAgentHistory` for the *current* session id. This is the function `SendMessage`'s
>    finished-agent path calls.
> 4. Wiring on the `SendMessage` side (`src/agent/tasks.ts` `TaskRegistry.sendMessage` +
>    `src/agent/runtime.ts`): today, hitting a terminal status throws `TaskFinishedError`
>    unconditionally (tasks.ts:311-322). Proposal: `AgentRuntime`'s `SendMessage` handling
>    (not `TaskRegistry.sendMessage` itself, which stays a dumb status/sink check) catches
>    `TaskFinishedError` for `kind === "agent"` tasks, reconstructs history via
>    `reconstructSubAgentHistory`, and re-invokes the *same* `spawnAgent()` machinery already
>    used for a fresh sub-agent — but with the target `id` reused (not a new task id: `start()`
>    already accepts a caller-supplied `id`, and `DuplicateTaskIdError` just needs the old
>    terminal entry cleared/replaced first) and an added `seedHistory: ProviderMessage[]`
>    passed through to the loop the same way `AgentRuntimeOptions.resume` seeds the root's
>    history today (`loop.ts` already has a documented trailing-role merge for appending the
>    new wake-up message onto replayed history — reuse it rather than inventing a second
>    merge). This means **no second code path for "start an agent loop with prior history" is
>    built** — root resume and sub-agent resume both bottom out in the same
>    "`AgentLoopParams` optionally seeded with history" shape; only how the history is
>    *sourced* (chain-walk vs. single-hop) differs, and that difference is now isolated to
>    resume.ts's two small callers.
>
> **Open question resolved:** no, `failed`/`stopped` should not resume differently than
> `done`. `--resume` itself (the existing, shipped behavior this mirrors) does not
> distinguish crash-terminal from clean-terminal sessions — D6 in the original resume design
> only cares about *chain* integrity, never about how the prior run ended. A message sent to
> a `failed` or `stopped` sub-agent should get the same treatment as one sent to a `done`
> one: full history reconstructed, new message appended, loop resumes. If the prior run
> failed, that failure is already visible in the replayed history (a `failed`-status log
> line, or a tool_result with `isError: true`) for the resumed agent to react to — no special
> casing needed at the reconstruction layer.
>
> **Design is settled enough to implement** — moving to `ready`. Remaining judgment calls
> (exact function names/signatures, where precisely in `runtime.ts` the `TaskFinishedError`
> catch belongs, whether `spawnAgent()` needs a new optional param or a sibling function) are
> normal implementer discretion, not open architecture questions. One thing flagged for
> Core to double check while implementing, not blocking: reused task ids need the
> `TaskRegistry`'s `completedOrder`/`terminalIds`/`readCursors` bookkeeping for the *old*
> terminal entry cleared before `start()` re-registers the same id, or the eviction queue
> and TaskOutput read-cursor state will carry stale entries forward under a live id.
