---
spile: ticket
id: DH-0207
type: feature
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

# DH-0207: Message queue: queued messages need visual 'queued' state + delete/cancel capability

## Summary

Manual testing finding (2026-07-19), UX gaps on top of DH-0140's already-confirmed-working queuing infrastructure: (1) queued messages show no visual distinction from sent messages in the Web UI -- users can't tell what's pending vs transmitted; (2) no way to delete/cancel a queued message before it's processed. Both needed for the message-queue feature to feel controllable rather than a black box. Web domain (Susan), depends on/extends DH-0140.

## User Stories

### As an operator who sends a message while the agent can't immediately receive it, I want to see that it's queued (not sent), so I'm not confused about whether it was actually delivered

- Given a `send_message` lands in an agent's not-yet-delivered `pendingMessages` queue (mid-turn/asleep), when the server emits the resulting `agent_queue` SSE snapshot, then the Web UI renders that turn with a distinct "queued" visual state (dashed border, "queued" badge) instead of looking identical to an already-delivered message. Test: `src/web/client/state.test.ts` `describe("agent_queue (DH-0207/DH-0208)")` (correlates a queue entry to the local-echo turn; membership check survives delivery/cancellation without a separate clear step); `src/web/client/components/Transcript.test.tsx` (queued-state rendering); `src/web/client/app.test.ts` "cancel button on a queued turn..." (end-to-end SSE-to-DOM).
- Given that same message is later delivered into the agent's conversation (drained at the top of its next turn), when the next `agent_queue` snapshot no longer contains that entry's id, then the turn silently reverts to ordinary sent-message styling. Test: `src/web/client/state.test.ts` "a turn's queuedMessageId sticks around after delivery/cancellation, but membership in the new (empty) snapshot goes away...".

### As an operator, I want a delete/cancel button on each still-queued message, so I can retract one I didn't mean to send before the agent ever sees it

- Given a message is currently queued, when the operator clicks its Cancel button, then the client sends `cancel_queued_message` (agentId, messageId) and the server removes that entry from `pendingMessages` before it's ever injected into the agent's conversation. Test: `src/agent/loop.test.ts` "registerCancelQueuedMessage removes a still-queued entry and reports it via onQueueChange... (asserts the cancelled text never reaches the provider)"; `src/agent/tasks.test.ts` `describe("cancelQueuedMessage (DH-0207/DH-0208)")`; `src/agent/runtime.test.ts` "cancelQueuedMessage(ROOT_AGENT_ID, ...) removes a still-queued entry from a live root..." and "...delegates to TaskRegistry"; `src/server/commands.test.ts` `describe("cancel_queued_message")`; `src/web/client/app.test.ts` "cancel button on a queued turn sends a cancel_queued_message command for that entry".
- Given the entry no longer exists (already delivered, or a duplicate cancel), when `cancel_queued_message` is sent, then the server acks 404 (`ok: false`) rather than silently pretending to succeed, and the client surfaces that as a normal command error. Test: `src/server/commands.test.ts` "404s when the agent loop reports nothing was cancelled..."; `src/agent/tasks.test.ts` "returns false (not an error) for a task that never registered a sink".

## Functional Requirements

1. `src/contracts/events.type.ts`: new `AgentQueueEvent` (`type: "agent_queue"`), carrying a full `QueuedMessage[]` snapshot (`{id, message, queuedAt}`) for one `agentId` — full-snapshot semantics (not a delta), matching `agent_status`/`agent_spawned`'s existing precedent so a client that misses one event still ends up correct on the next.
2. `src/contracts/commands.type.ts`: new `CancelQueuedMessageCommand` (`type: "cancel_queued_message"`, `agentId`, `messageId`), added to `ClientCommand`.
3. `src/agent/loop.ts`: `pendingMessages` is now `QueuedMessage[]` (server-generated id + `queuedAt`) instead of `string[]`; a new `registerCancelQueuedMessage` sink removes one entry by id; a new `onQueueChange` callback fires a full snapshot on every push/cancel/drain.
4. `src/agent/tasks.ts` / `src/agent/runtime.ts`: `TaskRegistry.cancelQueuedMessage()` / `AgentRuntime.cancelQueuedMessage()` thread the cancel sink through for both root and sub-agents, mirroring the existing `sendMessage()` root-vs-sub-agent split; `onQueueChange` is wired to emit `agent_queue` SSE events for both.
5. `src/server/commands.ts`: `cancel_queued_message` command handler — 404 for an unknown agentId or an entry that's no longer queued, 200 ack otherwise.
6. `src/web/client/state.ts`: `AgentNode.queuedMessages` stores the latest snapshot; `Turn.queuedMessageId` correlates a local-echo "user" turn to the queue entry it produced (matched by text, newest-unmatched-first, since the server doesn't echo back which turn produced which entry).
7. `src/web/client/components/Transcript.tsx`: queued-state styling (`.turn-queued`, badge, Cancel button) driven by `queuedMessageId` membership in the current snapshot.
8. `src/tui/state.ts`: no-op exhaustiveness case for `agent_queue` — TUI display is explicitly out of scope this round (Web-only per the ticket's own domain).

## Assumptions

- Reused DH-0140 Phase 2's already-sketched design (per-message entries, cancel command, queue-depth SSE event) rather than re-designing from scratch — DH-0140's Notes explicitly deferred this pending "a real ask," and this ticket (from 2026-07-19 manual testing) is that ask.
- Client-side correlation (matching a queue entry back to the local-echo turn that produced it) is done by text + FIFO order rather than a client-supplied message id, keeping `SendMessageCommand`'s wire shape unchanged (no contracts churn on the already-stable `send_message` command).

## Risks

- Text-based correlation could mis-match if two turns are ever queued with byte-identical text; accepted as low-risk (rare collision, and mis-correlation only affects which bubble shows the queued badge/cancel button, never message delivery order or content).

## Open Questions

(none — TUI queued-message display explicitly deferred, not designed here; file a follow-up ticket if/when there's a real ask for it, per the project's "defer speculative work" convention.)

## Notes

### 2026-07-19 — implemented alongside DH-0208 (shared backend plumbing), closed

Implemented together with DH-0208 since both extend the same `pendingMessages` queue and share
the new `agent_queue` SSE event (DH-0207's visual-state/cancel UI is also DH-0208's
completion/EOF signal for scripted callers — see DH-0208's own Notes for that half).

All 4 quality gates green: `bun run typecheck`, `bun run lint`, `bun run test:coverage`
(100.00% lines, 137/137 files passed), `bun run e2e` (each individual file passes in
isolation; the full-suite run's single flaky failure differs on every rerun and is unrelated
to this change — pre-existing headless-browser/real-process contention under `--parallel=1`
load, consistent with other tickets' gate notes in this repo).
