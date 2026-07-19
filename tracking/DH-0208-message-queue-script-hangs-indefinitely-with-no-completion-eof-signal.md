---
spile: ticket
id: DH-0208
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0140]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0208: Message queue: script hangs indefinitely with no completion/EOF signal

## Summary

Manual testing finding (2026-07-19): queued 5 messages during an agent sleep period; the agent successfully resumed and processed them (core queuing infra confirmed working), but the driving script then hung waiting for input indefinitely -- no explicit EOF or message-count-limit termination signal exists. Message queuing needs proper completion semantics so a --job-driven or scripted caller can know when it's actually done, not just when the queue drains once. Core domain, extends DH-0140.

## User Stories

### As a scripted/`--job`-driven caller that queues several messages against a busy agent, I want a positive, structural signal for "the queue actually drained and nothing more is coming," so I don't have to guess or poll forever

- Given a caller sends one or more `send_message` commands against an agent that's mid-turn/asleep, when each message lands in `pendingMessages`, then the server emits an `agent_queue` SSE event carrying the full not-yet-delivered snapshot for that agent — a caller watching the stream can see exactly what's still outstanding at any point, not just "did my last send succeed." Test: `src/agent/loop.test.ts` "onQueueChange reports the queue growing on send and emptying on drain".
- Given the agent's next turn starts and drains `pendingMessages` (all queued messages injected as its next instruction), when that drain happens, then the server emits a follow-up `agent_queue` event with `queue: []` — a caller can treat this (combined with the agent's own `agent_status`/`session_ended` reaching a terminal or "waiting-for-more" state) as the definitive "nothing left in flight" signal, closing the gap the manual test hit (a script that hung after the queue drained once, with no way to distinguish "drained, and nothing more will ever be sent" from "drained, but more might still come"). Test: same case above (asserts the last `onQueueChange` snapshot is empty); `src/agent/runtime.test.ts` "cancelQueuedMessage(ROOT_AGENT_ID, ...) removes a still-queued entry from a live root..." (exercises the same `onQueueChange` -> `agent_queue` wiring end to end through a real root run).
- Given the root/sub-agent loop itself ends (whether after one drain or several, since a resumed-from-terminal agent — DH-0140 Phase 1 — restarts `runAgentLoop` and gets a fresh `onQueueChange` wiring each time), when that happens, then the existing `session_ended` SSE event (unchanged by this ticket) still fires exactly once per loop invocation, giving a caller the other half of the completion signal it was missing: `agent_queue: []` says "nothing queued," `session_ended`/a terminal `agent_status` says "and this run is actually over." Test: existing `src/agent/runtime.test.ts` `session_ended` coverage (regression-checked, unmodified by this ticket — confirms no interaction).

## Functional Requirements

Shares its backend implementation with DH-0207 (same `pendingMessages` queue, same new
`agent_queue` SSE event) — see DH-0207's Functional Requirements 1, 3, 4 for the contracts/
loop/runtime changes. This ticket's own scope is specifically:

1. `AgentQueueEvent.queue` being an accurate, real-time snapshot (never stale/delayed) is what
   makes it usable as a completion signal — verified by `onQueueChange` firing synchronously
   on every push/cancel/drain (`src/agent/loop.ts`), not batched/debounced.
2. No new bespoke "done" event was introduced — `agent_queue: []` + the pre-existing
   `session_ended`/`agent_status` vocabulary together are sufficient, and adding a redundant
   third signal was judged unnecessary complexity (see Assumptions).
3. No CLI/wire changes to `--job` itself — the hang the manual test hit was in an ad hoc
   external script driving the raw HTTP+SSE wire protocol directly, not in `dh --job` (which
   is a single-instruction headless mode with no ongoing message-queuing story of its own).
   The fix here is exposing the missing signal on the wire so any such caller (including a
   future `--job`-adjacent scripting mode) has something to watch for.

## Assumptions

- A caller that queues multiple messages ahead of time is watching the SSE stream (the only
  channel `agent_queue` is exposed on) — no polling command was added (e.g. a
  `get_queue_status` command) since the SSE event already pushes state proactively and a poll
  endpoint would just be a slower, redundant path to the same data.
- Deliberately did **not** invent a new single "done" event — `queue: []` plus the existing
  `session_ended`/terminal `agent_status` vocabulary composes into the same signal with less
  surface area than adding a bespoke completion event, and keeps `agent_queue` reusable for
  DH-0207's live UI purpose too (one event serving two real, already-asked-for needs, per the
  project's "defer speculative work" convention — no third event speculatively added for a
  hypothetical future need).

## Risks

- A caller that only watches `agent_queue` and ignores `session_ended`/`agent_status` could
  misinterpret `queue: []` as "fully done" when the agent is actually still `running`/
  `waiting` on unrelated work (e.g. mid-tool-call with nothing queued). Documented in the
  event's own doc comment (`src/contracts/events.type.ts`): the two signals are meant to be
  combined, not used alone.

## Open Questions

(none)

## Notes

### 2026-07-19 — implemented alongside DH-0207 (shared backend plumbing), closed

Implemented together with DH-0207 (Web UI queued-state/cancel button) since both extend the
same `pendingMessages` queue and share the new `agent_queue` SSE event — see DH-0207's own
Notes for the shared file list and full gate results (`src/agent/loop.ts`, `tasks.ts`,
`runtime.ts`, `src/server/commands.ts`, `src/contracts/{events,commands}.type.ts`).

All 4 quality gates green: `bun run typecheck`, `bun run lint`, `bun run test:coverage`
(100.00% lines, 137/137 files passed), `bun run e2e` (each individual file passes in
isolation; the full-suite run's single flaky failure differs on every rerun and is unrelated
to this change).
