---
spile: ticket
id: DH-0140
type: feature
status: draft
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

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
