---
spile: ticket
id: DH-0078
type: feature
status: closed
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

# DH-0078: SendMessage/Monitor can only address a task by task_id, not by the human-readable name Claude Code allows

## Summary

Real Claude Code's SendMessage tool lets the caller address a previously spawned agent either by its task/agent ID or by the human-readable name it was given (per the same 'description' field DH-0069 makes required for tree labeling). dh's SendMessage (src/agent/tools/send-message.ts) and Monitor (src/agent/tools/monitor.ts) only accept task_id -- there is no name-based addressing once DH-0069 makes description a required, meaningful label. Natural small follow-on to DH-0069: once every sub-agent has a real name, letting the dispatching agent refer back to it by that name (not just an opaque id it must remember) would match real Claude Code's ergonomics.

## User Stories

### As a dispatching agent, I want to send a follow-up message to a sub-agent by the name I gave it, not by an opaque id I have to remember

- Given a sub-agent spawned with `description: "Fix flaky retry test"`, when the dispatching
  agent later wants to send it a follow-up message, then it can call SendMessage with
  `to: "Fix flaky retry test"` (or a close variant) instead of needing to have retained the
  raw task_id from the original spawn response.
- Given two sub-agents share a similar or identical description, when addressed by name,
  then the tool either disambiguates sensibly (e.g. most-recent match) or returns a clear
  error listing the ambiguous candidates -- never silently messages the wrong agent.

## Functional Requirements

- `src/agent/tools/send-message.ts`: accept either a task_id or a description/name string
  in the existing identifying parameter (or add a new optional one), resolving name lookups
  against the current set of tracked tasks (`ctx.tasks`).
- `src/agent/tools/monitor.ts`: same name-based addressing for consistency, since Monitor
  already reports `description` per task.
- Depends on DH-0069 landing first (description becomes a required, meaningful field) --
  addressing by name is far less useful while `description` is still optional and often
  absent.

## Assumptions

- Name resolution is scoped to the calling agent's own visible tasks (sub-agents it itself
  spawned, or that it has visibility into), not a global namespace across the whole run.

## Risks

- Ambiguity when multiple tasks share the same or similar description -- needs a defined
  resolution rule (error on ambiguity is the safer default, per the read-before-write guard
  precedent elsewhere in this codebase of erroring rather than guessing).

## Open Questions

- Exact disambiguation behavior on duplicate names: hard error listing candidates and their
  task_ids (recommended), or most-recent-wins?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. This is a direct, small follow-on
> to DH-0069 -- filed separately since it's a distinct parameter/behavior change on
> different tools (SendMessage/Monitor) rather than the Agent tool DH-0069 covers, and
> should likely be sequenced after DH-0069 lands.
