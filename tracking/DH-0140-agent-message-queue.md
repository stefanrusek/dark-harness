---
spile: ticket
id: DH-0140
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0140: Agents need an incoming-event message queue: mid-turn events (e.g. background sub-agent completions) are currently orphaned, not queued

## Summary

Found live 2026-07-17 reading session logs from a manual multi-agent stress test (a 3-parent haiku-fleet demo): a parent agent spawned 2 background sub-agents, entered a poll/sleep loop waiting for them, then got hit by DH-0050's missed-ReportOutcome nudge and ended its turn while its children were still genuinely running. When those children later delivered their completion notifications, the parent was already gone -- both notifications were dropped with 'Completion notification could NOT be delivered live (parent agent ... is not currently running/waiting -- orphaned or already finished)'. Root (the top-level coordinator in that session) noticed the gap, respawned the failed parent, and the overall task eventually completed -- but the orphaned children's own results were lost, only recovered because root happened to retry. Owner's diagnosis: agents need a real incoming-event message queue, not a live-delivery-or-drop model. Design proposal (owner's own words, to be handed to the architect for a real design pass before implementation, not implemented as-is): two queues per agent -- a user-message queue and a machine-message queue (background task completions, sub-agent completion notifications, nudges, etc). When an agent is mid-turn/busy (e.g. sleeping, waiting on a background Bash/Agent call) and cannot immediately receive, incoming events go into the appropriate queue rather than being dropped. Ordering: a new user message is inserted ahead of the machine-message queue but behind any already-queued user messages (i.e. user messages are FIFO among themselves and take priority over machine-originated events). Two separate queues (rather than one merged/prioritized queue) is deliberately chosen because it also sets up a natural future feature: letting an operator queue up multiple messages ahead of time and de-queue/cancel ones they no longer want sent before the agent gets to them -- a common chat-UX pattern this shape supports for free.

## Architect design pass (Fable, 2026-07-17)

**Verdict: the owner's diagnosis is right, but the fix is narrower than "build a new queue system."** A message queue for a *live* agent already exists (`pendingMessages` in `src/agent/loop.ts`, drained at the top of every turn) and already works correctly for the mid-turn/sleeping/waiting cases the owner describes. The bug that actually fired in the stress test is a different, more specific gap: a *terminal* agent's completion notification is dropped instead of triggering the resume path that DH-0003 already built for exactly this situation (a message arriving for a finished agent). See "What already works" below for the evidence, and "Root cause, precisely" for why the observed failure needed both that gap and a nudge-eagerness bug to fire together.

Full reasoning, code citations, and the resulting design are in **Notes** below. Short version:

- **Phase 1 (this ticket, ready to implement):** route `AgentRuntime.handleTaskSettled()`'s automatic completion-notification delivery through the same resume-capable path `AgentRuntime.sendMessage()` already uses for explicit operator/tool-driven messages (DH-0003), instead of the raw live-only `tryDeliverToAgent()`. Additionally, suppress the DH-0050 missed-ReportOutcome nudge when the agent has its own known non-terminal children (sub-agent or background-bash tasks it spawned that haven't reached a terminal status) — this is the surgical fix for the nudge's over-eagerness the owner flagged in point 3 of the assignment. Together these close the silent-loss bug: either the nudge no longer fires while children are outstanding, or (if it still ends the agent for some other reason, e.g. legitimate maxTurns) the notification resumes the agent instead of vanishing.
- **Phase 2 (explicitly out of scope for this ticket, needs its own ticket + architect sign-off on the contracts change):** the owner's two-queue *user-visible* model (dequeue/cancel UX, per-message granularity, an SSE event exposing queue depth). Phase 1's fix does not require this and does not block it — see "Contracts impact" below.

Status is `ready` for Phase 1 as scoped by the Functional Requirements below. Phase 2 is intentionally left undesigned in detail (Open Questions) — the owner should decide whether/when to spend architect + contracts-review time on it.

## User Stories

### As a background sub-agent whose parent has already ended its turn/life, I want my completion notification to still reach my parent, so that my results aren't silently lost

- Given a sub-agent task (agent-kind, spawned via the `Agent` tool) has finished (done/failed/stopped) and its `parentAgentId` task has *also* already reached a terminal status (done/failed/stopped) by the time the notification fires, when `AgentRuntime.handleTaskSettled()` runs, then the parent is resumed with the notification as its next instruction (via the same `resumeFinishedAgent()` path DH-0003 uses for explicit `SendMessage`), not merely logged as "could NOT be delivered live." Test: `src/agent/runtime.test.ts`, case covering `handleTaskSettled` against a parent task already in a terminal status — asserts a new turn starts for the parent's agent id with the notification as instruction, and the JSONL log records delivery (not the old "orphaned" wording).
- Given the parent is the root and the root has already ended (session concluded) when a late child notification arrives, when `handleTaskSettled()` runs, then the same resume behavior applies to the root (root is lazily restartable exactly as `invokeSkill()`'s root-lazy-start convention already does for explicit messages) — not silently dropped. Test: `src/agent/runtime.test.ts`, case covering a post-session-end `handleTaskSettled` call targeting `ROOT_AGENT_ID`.

### As a non-interactive agent that has spawned children and is explicitly waiting on them, I want the missed-ReportOutcome nudge not to end my turn out from under me, so that a legitimate wait isn't punished as a forgotten self-report

- Given a non-interactive agent has one or more of its own spawned tasks (sub-agents or background Bash calls) still in a non-terminal status (`running` or `waiting`) at the moment a turn ends with no tool call and no `ReportOutcome`, when the DH-0050 nudge check runs, then the nudge is skipped for that turn (the agent is not treated as having "forgotten" — its next turn is allowed to continue polling/waiting) rather than being sent and then, on the following non-tool-use turn, falling through to the legacy TASK_FAILED/clean-end determination while children are still outstanding. Test: `src/agent/loop.test.ts`, case with a `hasPendingChildren`-equivalent context set true — asserts no nudge message is injected and the loop does not terminate on that turn.
- Given the same agent's children have since all reached a terminal status, when a later non-tool-use turn ends with still no `ReportOutcome` call, then the nudge fires exactly as it does today (this story only suppresses the nudge while genuinely-outstanding children exist, it does not disable DH-0050 generally). Test: `src/agent/loop.test.ts`, case verifying nudge fires normally once children list is empty/terminal.

### As an operator sending a message to an agent that is mid-turn (already covered by existing `pendingMessages`, but re-verified here since Phase 1 touches adjacent code), I want my message delivered on the agent's next turn, not dropped

- Given an agent is mid-turn (actively running a tool call or awaiting the provider), when `SendMessage`/the wire `send_message` command targets it, then the message is queued via the existing `registerSendMessage` sink and injected as a `user`-role message at the top of the agent's next turn — unchanged behavior, asserted by the existing `src/agent/loop.test.ts` coverage for `pendingMessages`; called out here only to confirm Phase 1 does not regress it. Test: existing `src/agent/loop.test.ts` `pendingMessages` cases (no new test required, regression-checked as part of Phase 1's review).

## Functional Requirements

**Phase 1 (in scope for this ticket):**

1. `AgentRuntime.handleTaskSettled()` (`src/agent/runtime.ts`) must attempt delivery via a resume-capable path, not `tryDeliverToAgent()`'s live-only check. Concretely: call the same logic `AgentRuntime.sendMessage()` uses (live delivery if the target is running/waiting, else `resumeFinishedAgent()`/root-lazy-restart if terminal), and adjust the JSONL log line's wording accordingly (distinguish "delivered live" vs "delivered via resume" vs, if truly unreachable — e.g. task id evicted/unknown — "could not be delivered," which should now be rare/never for a task registry that never evicts, per tasks.ts's existing "tasks are never evicted" comment).
2. `TaskRegistry` (or `AgentRuntime`) must expose a cheap way to ask "does agent X have any of its own child tasks (sub-agent or bash, kind-agnostic) in a non-terminal status (`running`/`waiting`) right now" — a filter over `list()` by `parentAgentId` is sufficient given tasks are never evicted; no new indexing structure required unless `list()` is shown to be a hot path (it is only called from the tree endpoint and this new check today).
3. `runAgentLoop` (`src/agent/loop.ts`)'s DH-0050 nudge branch (`completion.stopReason !== "max_tokens" && !nudged`) must additionally check "does this agent have outstanding non-terminal children" (via the mechanism from FR2, threaded into `AgentLoopParams`) and skip the nudge (falling through to `continue`-equivalent — i.e. just start another turn without injecting the nudge message or marking `nudged`) when true. This must not disable the eventual legacy fallback (TASK_FAILED scan / max_tokens) if the agent keeps ending turns with no tool call after all its children finish — only suppress the nudge specifically while children are outstanding.
4. No change to the existing `pendingMessages` mechanism's ordering/draining semantics — Phase 1 does not touch it beyond what FR1's routing changes require (none expected; `resumeFinishedAgent()` starts a fresh loop invocation with its own fresh `pendingMessages`, so no interaction).
5. No `src/contracts/` changes required for Phase 1 (see "Contracts impact" below).

**Phase 2 (out of scope, tracked here only as a pointer to a future ticket — do not implement against these until that ticket exists and is designed):**

6. A user-facing "queued message" UX (multiple operator messages queued ahead of time, de-queue/cancel before send) requires: per-message (not joined-string) entries in `pendingMessages`, a way to address/cancel an individual queued entry (new wire command), and a new SSE event exposing queue state to TUI/Web — all contracts changes needing their own architect-reviewed ticket per CLAUDE.md §6 trigger 2.

## Assumptions

- Tasks are never evicted from `TaskRegistry` (confirmed in `tasks.ts`'s own comments, e.g. around `getAgentTree()`'s "tasks are never evicted" note) — this is what makes FR1's "there's always a task snapshot to resume from" assumption safe. If that assumption ever changes (e.g. a future memory-bounding eviction policy), FR1's resume path would need a genuine "unreachable" fallback, which does not exist today and isn't designed here.
- "Outstanding children" for FR2/FR3 means tasks this specific agent itself spawned (`parentAgentId === agentId`), not transitively (grandchildren aren't this agent's direct concern — its own child already re-parents that responsibility to itself once it's spawned). Matches the existing orphaned-grandchild handling design already documented in `handleTaskSettled()`'s doc comment (each level is responsible for its own direct children's notifications, with its own log as the durable fallback).
- `resumeFinishedAgent()`'s existing behavior (treats `failed`/`stopped` sub-agents identically to `done` ones when resuming) is correct and unchanged by this ticket — a completion notification arriving for a failed parent should still resume it (the parent gets to see why its child failed and decide what to do), matching DH-0003's existing design intent.

## Risks

- Resuming a terminal parent automatically (FR1) means a parent that legitimately finished and reported its outcome could be "reopened" by a late-arriving child notification arriving after the parent's own `ReportOutcome`/completion — this is DH-0003's existing behavior for explicit `SendMessage` today (not new), but Phase 1 makes it happen automatically/silently more often (every background-task completion race, not just an operator's deliberate follow-up). Root's exit-code/session-outcome semantics need to keep working when a "finished" root gets reopened this way — verify against existing DH-0003 test coverage rather than assuming it's already covered for the *automatic* trigger path.
- FR2/FR3's nudge suppression could, in a pathological case (a child that itself hangs forever, e.g. genuinely stuck / infinite loop), leave the parent polling forever with the nudge never firing to force a self-report — effectively removing DH-0050's safety net for this specific shape of hang. Mitigated by `maxTurns` (loop.ts's existing whole-conversation cap) still applying regardless — a hung poll loop still terminates as a failure eventually, just via the maxTurns path instead of the nudge path. Worth confirming in review that this is an acceptable trade (probably yes: maxTurns already exists as the safety valve of last resort per the module's own Round 5 doc comment).

## Open Questions

- Phase 2 (owner's full two-queue UX + contracts event): should the coordinator file this as a separate ticket now, or defer until an operator actually asks for the dequeue-UX feature? Per the user's own memory note ("defer speculative work... sweep-sourced hardening/features with no real incident or ask behind them: defer entirely"), and since Phase 1 fully closes the reported incident, recommend **deferring Phase 2** until there's a real ask for the multi-message-queue UX, rather than speccing it now. Flagging explicitly rather than silently dropping it, per the assignment's instruction not to fold contracts-touching scope in silently.
- Should FR1's "resume a terminal parent automatically" apply to *every* kind of terminal status equally, or should a `stopped` parent (explicitly stopped by an operator/TaskStop) be treated differently — e.g. respect the stop and log-only rather than auto-resuming? DH-0003 already resumes `stopped` sub-agents identically to `done`/`failed` ones for explicit SendMessage, so this ticket's Assumptions section takes the position "no difference," but it's worth the implementer double-checking this doesn't surprise anyone in review, since an operator-stopped agent silently coming back to life on an unrelated child's completion is a slightly different flavor of "surprising resume" than an operator's own deliberate follow-up message.

## Notes

### 2026-07-17 — Phase 1 implemented, moved to verifying

Implemented exactly the Phase 1 scope FR1-FR4 describe, no Phase 2 work:

- **FR1**: added `AgentRuntime.deliverOrResumeAgent()` (`src/agent/runtime.ts`), replacing the
  old live-only `tryDeliverToAgent()` as `handleTaskSettled()`'s delivery path. Root case
  mirrors `invokeSkill()`'s root-lazy-start convention (live send if running/waiting, else
  fire-and-forget `runRoot()`); sub-agent case mirrors `sendMessage()`'s
  `TaskFinishedError`-triggered `resumeFinishedAgent()` call. The JSONL system log line now
  distinguishes `"delivered live"` / `"delivered via resume"` / (the should-be-unreachable)
  `"could not be delivered"`.
- **FR2**: added `TaskRegistry.hasNonTerminalChildren(parentAgentId)` (`src/agent/tasks.ts`) —
  a plain filter over the existing `list()`, no new indexing structure.
- **FR3**: `runAgentLoop`'s DH-0050 nudge branch (`src/agent/loop.ts`) now checks a new
  `AgentLoopParams.hasPendingChildren?: () => boolean` (threaded from `AgentRuntime` via
  `TaskRegistry.hasNonTerminalChildren()` for both the root and every sub-agent loop
  invocation) and, when true, skips the nudge entirely for that turn — no nudge injected, no
  `nudged` flag set, no fall-through to the legacy TASK_FAILED/clean-end determination — just
  starts another turn. Once children clear, the nudge fires normally on the next non-tool-use
  turn.
- **FR4**: no changes to `pendingMessages`/its ordering — confirmed no regression via the
  existing `src/agent/loop.test.ts` `pendingMessages` coverage (still green, unmodified).
- No `src/contracts/` changes (FR5) — confirmed nothing new crosses the SSE/JSONL/wire
  boundary; this is entirely `AgentRuntime`/`TaskRegistry`/`AgentLoopParams` internal.

**Tests** (CLAUDE.md §9 — one per User Story bullet):

- User Story 1 (late notification resumes a terminal sub-agent parent): `src/agent/runtime.test.ts`,
  `"orphaned grandchild: if the parent has already finished, the notification resumes it
  instead of being lost"` (rewritten from the old drop-and-log version to use a real
  `spawnAgent()` + `SessionLogger`-backed runtime so `resumeFinishedAgent()`'s
  `reconstructSubAgentHistory()` call has a real JSONL file to read, matching how this path is
  actually reached in production — only `spawnAgent()` ever creates `agent`-kind tasks).
- User Story 2 (post-session-end root resume): `src/agent/runtime.test.ts`, two cases —
  `"a background task's completion lazily (re)starts a root that hasn't started yet, instead
  of being dropped"` and `"a background task's completion resumes the root after its own
  session has already concluded"`.
- User Story 3 (nudge suppressed while children outstanding) and its "fires normally once
  children finish" counterpart: `src/agent/loop.test.ts`, `"DH-0140: the nudge is skipped (not
  just deferred) while hasPendingChildren() reports outstanding children..."` and `"DH-0140:
  once hasPendingChildren() reports no more outstanding children, the nudge fires normally on
  the next non-tool-use turn"`.
- User Story 4 (`pendingMessages` regression check): existing `src/agent/loop.test.ts`
  `pendingMessages` cases, unmodified and still passing — no new test needed per the ticket's
  own text.
- `TaskRegistry.hasNonTerminalChildren()` itself: `src/agent/tasks.test.ts`, new
  `describe("hasNonTerminalChildren (DH-0140: nudge-suppression check)")` block (6 cases:
  agent-kind child running, bash-kind child running, `waiting`-status child, all-terminal,
  no-children, grandchildren-excluded).

**Pre-existing test updates required by the new (correct) behavior**: two existing
`runtime.test.ts` cases previously asserted the old drop-on-terminal-parent /
drop-on-unstarted-root behavior (`"...could NOT be delivered live..."`) — updated in place to
assert the new resume/lazy-start behavior instead (see the "orphaned grandchild" rewrite
above and the lazy-root-start test). One unrelated `getAgentTree()` test
(`"nests agent-kind sub-agents under their parent, excluding bash-kind tasks"`) started
exercising the new lazy-root-start path as a side effect of its own fixture (a background
task/sub-agent parented to `ROOT_AGENT_ID`) — fixed by marking those two fixture tasks
`background: false`, since the test is about tree structure, not completion notifications.

**Gates**: `bun run typecheck` clean; `bun x biome check` clean on all touched files (full
`bun run lint` has 12 pre-existing formatter-only failures in unrelated files, confirmed
present on `main` before this change); `bun test src --coverage` — 2120 pass / 3 fail, the 3
failures (`AnthropicProvider`/`createProvider` real-SDK-client construction) confirmed
pre-existing on `main` unmodified (env-dependent, unrelated to this ticket); `bun run e2e` — 36
pass / 2 fail, both failures (a `.status-badge` text-casing assertion in `web.test.ts`/
`connect-web.test.ts`) confirmed pre-existing on `main` unmodified.

Commit: (see git log — committed with explicit pathspec covering only
`src/agent/{runtime,loop,tasks}.ts` and their `.test.ts` files).

### Validating the owner's two-queue proposal against the actual architecture

I read `src/agent/loop.ts`, `src/agent/runtime.ts`, `src/agent/tasks.ts`, and `src/agent/resume.ts` in full before designing this. Three load-bearing facts changed my read of the problem from "we need to build a queue" to "we need to route an existing gap through an existing mechanism":

**1. A message queue for a live agent already exists and already works.** `runAgentLoop` (`loop.ts`) accepts `registerSendMessage`, which installs a sink (`fn`) that `AgentRuntime` wires to `task.sendMessage` (`tasks.ts` `spawn()`, line ~191). Calling that sink pushes onto a closure-local `pendingMessages` array (declared near the top of `runAgentLoop`, referenced at `loop.ts:680`), which is drained — every queued entry joined and injected as one `user`-role message — at the very top of the *next* turn (`loop.ts:680-690`), before the provider is called. This is already "queue while busy, deliver when free," and it already covers exactly the "agent is mid-turn/sleeping/awaiting a background call" case the owner's proposal opens with (User Story 4 above just reconfirms this rather than changing it). Round 12 (`handleTaskSettled`'s own doc comment, `runtime.ts:1378-1400`) explicitly reuses this same mechanism for background-task completion notifications ("Reuses Round 5's existing pending-message queue"). So: the queue-while-alive half of the owner's ask is not a gap.

**2. The actual gap is queue-when-dead, and DH-0003 already half-solved it — just not for this call path.** `tryDeliverToAgent()` (`runtime.ts:1428-1447`), which `handleTaskSettled()` calls, checks `isLiveStatus()` (running/waiting) *before* even attempting `tasks.sendMessage()`, and returns `false` (dropped, log-only) if the target isn't live. But `AgentRuntime.sendMessage()` (`runtime.ts:1203-1216`, DH-0003) — the method every *other* message-delivery caller goes through (the `SendMessage` tool, the wire `send_message` command) — already handles exactly this "target is terminal" case: it catches `TaskFinishedError` and calls `resumeFinishedAgent()`, which reconstructs the agent's prior conversation from its own JSONL log (`reconstructSubAgentHistory`, `resume.ts`), clears the terminal `TaskRegistry` entry, and re-spawns the same agent id with the history seeded and the new message as the next instruction. `handleTaskSettled()` is the *one* caller that bypasses this and goes straight to the raw live-only check. That's the actual bug: not "no queue exists," but "the automatic-notification path doesn't use the queue-and-resume machinery the explicit-message path already has." Phase 1 (FR1) is simply: make `handleTaskSettled()` call through the same logic `sendMessage()` uses, instead of `tryDeliverToAgent()`.

**3. Why the two-queue (user vs. machine) distinction, specifically, doesn't change Phase 1's fix.** The owner's ordering rule (new user message ahead of machine queue, behind existing user messages) matters once you're deciding *what order to inject multiple already-queued items* into a *live* agent's next turn. That's real and worth doing for Phase 2's UX goal, but it's orthogonal to the bug that actually fired: the stress-test failure was never about ordering between a queued user message and a queued machine message arriving at the same live agent — it was about a machine message arriving for an agent that was *already dead*, where there was no live queue to order anything into at all. Splitting `pendingMessages` into two queues today, without also building the resume-on-terminal path, would not have fixed the observed bug (a dead agent doesn't drain either queue). Building the resume-on-terminal routing (FR1) does fix it, using existing DH-0003 machinery, independent of whether `pendingMessages` is one array or two. So: the owner's two-queue model is *right* for Phase 2 (the future dequeue-UX goal — it's a sound design for that, no correction needed there), but *not the load-bearing fix* for the bug DH-0140 actually reports. I'm recommending Phase 2 be deferred (a separate ticket, contracts-reviewed) rather than bundled into the fix for the reported incident, per CLAUDE.md §6 trigger 2 and the standing "defer speculative work" guidance.

### Granularity question the owner's decomposition (§1 of the assignment) asked about directly

"Does 'agent cannot immediately receive' map cleanly onto existing state, or is there a finer distinction (waiting-for-next-turn vs. actively-mid-turn) that matters for correctness?" — Answer: the existing `running`/`waiting` vs. terminal (`done`/`failed`/`stopped`) distinction is sufficient for Phase 1's purposes and needs no finer state. There is no meaningful difference, from the queue's point of view, between "mid-provider-call" and "between turns about to start the next one" — both are `running`, both already correctly queue-and-drain via `pendingMessages`/the sink. The only state transition that actually matters for this bug is live → terminal, which is exactly what `AgentRuntime.sendMessage()`'s existing `TaskFinishedError` catch already detects. No new `TaskRegistry` states are needed.

### Does the queue need to survive a process restart?

No, and this doesn't change with Phase 1. `pendingMessages` is in-memory, scoped to one `runAgentLoop` closure, and dies with the process — consistent with every other piece of live in-flight state in this codebase (`AgentRuntime`'s in-memory `TaskRegistry`, etc.). `--resume` (DH-0038) and DH-0003's resume-a-finished-agent path both work by replaying JSONL history, not by resurrecting an in-memory queue — a message that was sitting in `pendingMessages` at process-crash time is, today, simply lost (out of scope for this ticket; it's a pre-existing property of the whole in-memory model, not something DH-0140's reported incident exercised — the stress-test failure happened within a single live process). Flagging this as a known, pre-existing, and unchanged limitation rather than silently assuming it away: a true crash-durable queue would be a much larger change (needs a persisted queue file or DB, touches the exit-code/session lifecycle contract) and nothing in the DH-0140 report calls for it.

### Nudge-vs-children interaction (§3 of the assignment)

Recommended as the more surgical fix, per the assignment's own suggestion, and implemented as FR2/FR3 above. Cheaper and more targeted than trying to make the queue itself "smart" about in-flight nudges: instead of asking "is there a pending machine message for this agent right now" (which has an unavoidable race — a child could finish *just after* the nudge check but *before* the nudge would have fired), ask the more stable question "does this agent know it has children it hasn't heard back from yet" (a structural fact derivable from `TaskRegistry.list()`, not a timing-sensitive queue-peek). This is more robust than gating on queue contents and directly encodes the actual judgment error in the stress test: the agent had explicitly said "let me wait for my children" and was punished for waiting exactly as instructed.

### Contracts impact

**Phase 1: no `src/contracts/` changes.** FR1 reuses existing `AgentRuntime`/`TaskRegistry` internals; FR2/FR3 add an internal (non-wire) helper and an internal `AgentLoopParams` field. Nothing new crosses the SSE/JSONL/wire boundary.

**Phase 2 would require a contracts change** (a new SSE event and/or `AgentStatus`-adjacent field exposing "N messages queued" for TUI/Web, per the owner's stated future de-queue-UX goal) — flagged per CLAUDE.md §6 trigger 2, not folded into this ticket, and not designed in detail here (see Open Questions).

### Effort/sequencing recommendation

**Single implementer round, Core domain (Grace)** — this is not a DH-0133-scale decomposition. FR1-FR4 touch `src/agent/runtime.ts` (routing change in `handleTaskSettled()`, small helper), `src/agent/tasks.ts` (a `list()`-based filter, likely already sufficient as a plain function over the existing `list()` return, no schema change), and `src/agent/loop.ts` (one additional condition in the existing nudge branch, one new optional `AgentLoopParams` field threaded from `runtime.ts` the same way `pricing`/`thinking`/etc. already are). All three files are already Core-owned (`src/agent/`), so no cross-domain handoff is needed. Recommend implementing FR1 and FR2/FR3 together in one PR since FR3 depends on FR2's helper and both are needed to fully close the reported incident (FR1 alone would still let the nudge fire and orphan children — just recover from it a turn later instead of never; FR2/FR3 alone doesn't help if the parent ends for an unrelated reason). Test coverage per the User Stories above is `src/agent/runtime.test.ts` and `src/agent/loop.test.ts` additions only — no e2e or integration tier needed (this is deterministic harness-internal behavior, not model-behavior-dependent).

- 2026-07-19: Manual testing pass (`temp-manual-testing.md`) live-verified the core mechanism
  works: queued 5 messages during an agent sleep period, and the agent successfully resumed
  and processed them once it came back from the blocking read — confirms the queuing
  infrastructure itself is functioning. Two real gaps found on top of that, filed as separate
  tickets rather than folded in here (extend, don't reopen, this ticket's own scope):
  DH-0207 (no visual "queued" state + no delete/cancel capability in the Web UI) and DH-0208
  (the driving script/caller has no completion/EOF signal — it hung indefinitely after the
  queue drained once, with no way to know the run was actually done).
