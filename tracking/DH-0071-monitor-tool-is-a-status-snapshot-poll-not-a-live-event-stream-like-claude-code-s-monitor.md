---
spile: ticket
id: DH-0071
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0071: Monitor tool is a status-snapshot poll, not a live event stream like Claude Code's Monitor

## Summary

Real Claude Code's Monitor tool streams events from a running background task -- each stdout line delivered as a notification -- so the calling agent can watch live progress. dh's Monitor (src/agent/tools/monitor.ts) instead returns a static one-line status summary (id/kind/status/model/description) per task_id at call time, with no push/streaming semantics. Found via schema/behavior comparison against real Claude Code's tool set (the exercise that produced DH-0069).

## User Stories

### As an agent supervising a long-running background task, I want to see its progress as it happens, not just a status snapshot

- Given a background Bash task or sub-agent producing ongoing output, when the calling
  agent calls Monitor, then it can observe new output as it arrives rather than only a
  point-in-time status line.
- Given Monitor is called repeatedly on the same task_id, when new output has appeared
  since the last call, then the caller can tell what's new without re-reading the whole
  transcript (this already exists for TaskOutput's incremental-delta mode; Monitor lacks
  any equivalent notion of "new since last look").

## Design decision (architect, Fable, 2026-07-16)

**Decision: keep Monitor as the lightweight multi-task status snapshot — document the
divergence and add one Core-only micro-enhancement (an unread-output count per status
line). Do not redesign toward push, do not merge into TaskOutput, do not touch
`src/contracts/` or `src/server/`.** Reasoning and empirical grounding below; the concrete
spec replaces the original open-ended Functional Requirements.

### Empirical findings (real Claude Code tested live, per the DH-0069/70 practice)

The architect inspected real Claude Code's Monitor tool schema directly and armed a live
Monitor on a script emitting timestamped lines over ~20s, observing delivery end to end:

1. **Real CC's Monitor is not a task-status poll at all.** Its input schema is
   `{command | ws, description, timeout_ms, persistent}` — there is **no `task_id`
   parameter**. It *arms a brand-new watcher* (a shell command or a WebSocket) whose
   stdout lines / frames become events; exit ends the watch. Checking on an
   already-started background task is a *different* CC surface (TaskOutput/BashOutput plus
   automatic completion notifications). dh's Monitor (status lines for existing
   `task_ids`) and CC's Monitor are **unrelated tools that happen to share a name** —
   there is no "upgrade path" from one to the other, only wholesale replacement with a
   different tool. This ticket's original premise ("CC's Monitor streams events from a
   running background task") was half-right: it streams, but not from your existing tasks.
2. **CC's "streaming" delivery to the agent is message injection at turn boundaries, with
   batching — not a live interrupt.** In the live test, three events emitted at :39/:43/:47
   while the agent was mid-turn queued up and arrived *together, as one batch of injected
   system messages* at the next turn boundary; stream-end likewise arrived as an injected
   completion notification. Nothing interrupts a model's own generation. For an
   agent-facing tool, "streaming" fundamentally *means* "everything new since your last
   turn boundary, delivered without you asking" — a delta, pushed as messages rather than
   pulled as a tool result. The underlying mechanism is the same incremental-retrieval
   model dh already has; only the initiation direction differs.
3. **dh already owns both halves of that substrate.** Incremental pull:
   `TaskRegistry.outputSince(id, readerId)` (per-reader cursor) backing TaskOutput's
   default delta mode. Push-into-parent-turn: `AgentRuntime.handleTaskSettled` →
   `tryDeliverToAgent` → the same pending-message sink SendMessage uses — already used
   today to push background-task *completion* notifications (with full output) into the
   parent's conversation (core Round 12). The only sliver dh lacks vs CC is *push of
   intermediate output while a task is still running*, and no current dh scenario demands
   it: the dark-factory pattern is spawn → completion-push → read, and mid-run inspection
   is served by TaskOutput's delta at whatever cadence the parent chooses.
4. **The original ticket's assumption that a push redesign "needs SSE /
   `src/contracts/`" is wrong.** SSE is the server→human-client channel, and human clients
   *already* watch every agent's output live (`agent_output` events). Delivery to a
   tool-calling agent is entirely in-process (the runtime's message-injection substrate
   above). Even a full push redesign would be Core-only and would never touch the wire
   contracts. This removes the main cost argument that made option (b) look heavy — but it
   also removes most of (b)'s point, since the wake-on-event half of push already exists
   for the completion case.

### Why not merge Monitor into TaskOutput (the original Open Question)

They answer different questions. Monitor is a *fan-out* status check — one call, N tasks,
no output content, cheap; exactly what a coordinator polling several sub-agents needs.
TaskOutput is a *single-task content fetch* with per-reader delta cursors. Merging would
force an array-of-ids × delta-cursor product into one contract and would silently advance
read cursors on what the caller intended as a status glance. Two tools, one line of
description each pointing at the other, is the simpler contract. (CC keeps status and
content concerns in separate surfaces too, just partitioned differently.)

### Why not build a CC-style watcher Monitor now

It would be a *new feature* (arm a command/pipe whose stdout lines are injected into the
parent's conversation as they appear), not a fix to this tool — and per this ticket's own
risk note, it should not ride in on a bug about an overpromising description. If a real
scenario emerges where TaskOutput-delta polling plus completion-push is insufficient
(e.g. "wake me on the first ERROR line of an hour-long build"), file it as its own feature
ticket; the design note there should start from finding 4 above — it is Core-only (runtime
message injection), no contracts change.

## Functional Requirements

All changes are **Core domain** (`src/agent/`), plus an optional one-line Prompt note.
No `src/contracts/`, no `src/server/` changes.

1. **`src/agent/tasks.ts`**: add a non-advancing peek alongside `outputSince`:

   ```ts
   /** How many chars of task `id`'s output `readerId` has not yet retrieved via
    * outputSince(). Read-only peek — does NOT advance the reader's cursor (Monitor uses
    * this; a status glance must never eat TaskOutput's pending delta). */
   unreadLength(id: string, readerId: string): number
   ```

   Implementation: total accumulated output length minus
   `readCursors.get(id)?.get(readerId) ?? 0`. Throws `TaskNotFoundError` like its siblings.

2. **`src/agent/tools/monitor.ts`**: `inputSchema` unchanged (`task_ids: string[]`,
   required, non-empty). Each status line gains an unread-output field, e.g.:

   ```
   agent-3 [agent] status=running model=small description="lint sweep" unread=1842 chars
   ```

   (`unread=0 chars` when nothing new; uses `ctx.tasks.unreadLength(id, ctx.agentId)`.)
   This makes Monitor the cheap "anything new across my N tasks?" check and TaskOutput the
   fetch — one Monitor call over everything, then TaskOutput only on the tasks whose
   unread count is interesting.

3. **`src/agent/tools/monitor.ts` description** — replace with exactly:

   > Check the current status of one or more background tasks or sub-agents by task id.
   > Returns one point-in-time status line per task (id, kind, status, model, description,
   > and an unread-output count: how many chars of output you have not yet retrieved via
   > TaskOutput). This is a snapshot poll, not a live stream, and it only reports on tasks
   > already started by Bash or Agent — it does not take a command or start watchers. To
   > read the new output itself, call TaskOutput (incremental by default). You never need
   > to poll for completion: a finished background task pushes its completion notification
   > into your conversation automatically.

   The "does not take a command or start watchers" sentence is deliberate: it defuses the
   name collision with real Claude Code's Monitor for models carrying CC priors (which
   would otherwise try `{command, description, timeout_ms}` and hit a schema error).

4. **Tests** (Core): `unreadLength` unit coverage including cursor non-advancement
   (Monitor glance, then TaskOutput must still return the full delta), unknown id, and the
   updated Monitor line format. 100% coverage gate applies as usual.

5. **Optional, Prompt domain (a request to Iris, not a Core edit)**: the system prompt's
   polling guidance (`src/prompt/system-prompt.ts` — the "fire-and-forget" and "pace your
   polling" bullets) is already accurate and does not overpromise streaming; optionally add
   one line noting that background-task completion arrives as a pushed notification, so
   polling is for *mid-run* checks, not for detecting completion. Not required to close
   this ticket.

## Assumptions

- (Validated by the architect's live test, above.) TaskOutput's delta mode plus the
  existing completion-push already deliver the practical value of "streaming" for an
  agent-facing consumer; the residual gap (mid-run wake-on-event) is real but currently
  demand-free and explicitly out of scope.

## Risks

- The unread count reads the same cursor TaskOutput advances; the non-advancing peek
  (`unreadLength`, FR 1) exists precisely so a Monitor glance can never swallow a pending
  TaskOutput delta — the test in FR 4 pins that.

## Open Questions

None — resolved above: keep two tools (no merge); no push redesign; no contracts change;
a CC-style watcher tool is deferred to a future feature ticket if demand appears.

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069.
