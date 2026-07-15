---
spile: ticket
id: DH-0003
type: feature
status: draft
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

- Should resuming a `failed`/`stopped` agent behave differently than resuming a `done` one?

## Notes

> [!NOTE]
> Current (correct, but partial) behavior: `SendMessage` to a finished task now returns a
> clear error naming it as already finished, rather than silently losing the message. That
> is the fix that already shipped; this ticket is the fuller "actually resume it" behavior.
