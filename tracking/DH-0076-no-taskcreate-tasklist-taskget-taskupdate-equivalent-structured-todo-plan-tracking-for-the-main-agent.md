---
spile: ticket
id: DH-0076
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0076: No TaskCreate/TaskList/TaskGet/TaskUpdate-equivalent structured todo/plan tracking for the main agent

## Summary

Real Claude Code has a TaskCreate/TaskGet/TaskList/TaskUpdate tool family (a structured todo-list the main agent maintains for its own multi-step plan, visible to the operator), distinct from the TaskOutput/TaskStop/Monitor/SendMessage tools dh already has for supervising spawned sub-agent jobs. dh has no equivalent for an agent tracking its own in-progress plan/checklist. This is a judgment call on whether it's worth building for dh's coding-agent use case (long multi-step coding tasks) versus being purely cosmetic; filed as draft for scoping.

## User Stories

### As an operator watching a long multi-step coding task, I want to see the agent's own plan/checklist, not just its raw tool calls

- Given an agent working a task with several discrete steps, when it maintains a structured
  todo list via TaskCreate/TaskUpdate-equivalent calls, then the TUI/Web UI can render that
  checklist (done/in-progress/pending) as a first-class view, distinct from the raw
  tool-call transcript.
- Given a sub-agent spawned via the `Agent` tool (already tracked via TaskOutput/Monitor/
  SendMessage/TaskStop), when it also maintains its own internal todo list, then the two
  concepts (job supervision vs. self-tracked plan) are clearly distinguishable in the UI and
  don't get conflated.

## Functional Requirements

- New tool(s): `src/agent/tools/task-create.ts` etc. (naming should avoid collision with
  the existing job-supervision `Task*` concept in dh's Monitor/TaskOutput/TaskStop/
  SendMessage family -- consider a different name, e.g. `Plan`/`Todo`, to avoid confusing
  two unrelated "task" concepts in dh's own vocabulary).
- If surfaced in TUI/Web, needs a `src/contracts/` addition (a plan/checklist state
  broadcast over SSE) -- architect sign-off per Constitution §6.2 if pursued.

## Assumptions

- This is the most speculative/judgment-call-heavy finding in this batch: real Claude
  Code's own internal todo-tracking may be largely a UX/self-organization aid for the model
  rather than something operators specifically asked for in dh; worth confirming actual
  operator value before committing to a contracts change.

## Risks

- Name collision with dh's existing "Task" vocabulary (TaskOutput/TaskStop/task_id for
  sub-agent jobs) is a real risk -- needs a different name to avoid confusing two unrelated
  concepts.
- Could be low-value if the model's own todo list is not meaningfully different from just
  narrating its plan in text (which it already can do) -- worth scoping a cheap version
  (no contracts change, just an in-context self-tracking convention) before building a full
  UI-visible feature.

## Open Questions

- Is this worth building as a first-class tool+UI feature, or would prompt-level guidance
  (Prompt domain) asking the model to narrate its plan in text achieve most of the value
  at far lower cost?
- If pursued, what's the right name to avoid clashing with dh's existing Task*/task_id
  vocabulary for sub-agent job supervision?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Filed for completeness per the
> "file everything real, don't pre-filter for importance" instruction, but flagged here as
> the lowest-confidence/most speculative finding in the batch -- may turn out to be a
> judgment call the coordinator declines to pursue.
