---
spile: ticket
id: DH-0071
type: bug
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

## Functional Requirements

- `src/agent/tools/monitor.ts`: clarify and likely redesign the tool's contract. Two
  options for scope: (a) keep Monitor as the lightweight status-line tool it is today and
  document that it deliberately diverges from Claude Code's streaming semantics, in favor
  of `TaskOutput`'s delta mode already covering the streaming use case; or (b) change
  Monitor to genuinely push/notify on new output lines, closer to real Claude Code's model.
  This ticket does not prejudge which; it requires a design decision.
- If (b), needs a delivery mechanism -- likely SSE (`src/contracts/`, `src/server/`) since
  dh's protocol is already SSE-based (ADR 0002), so this may need architect sign-off per
  Constitution §6.2 if it touches `src/contracts/`.
- Whichever direction, the Monitor tool's description text (and any prompt doc) should stop
  implying "streaming" if the tool doesn't do that, or be updated to say it now does.

## Assumptions

- dh's existing TaskOutput (`full` vs incremental-delta) may already deliver most of the
  practical value of "streaming," making this more of a naming/expectation-setting fix than
  a from-scratch feature -- worth scoping down before committing to a heavier redesign.

## Risks

- A real push/streaming Monitor is a materially bigger feature than the status-snapshot
  version that exists today; scope creep risk if not bounded to "what does the operator/
  agent actually need beyond TaskOutput's delta mode."

## Open Questions

- Is the gap purely cosmetic (Monitor's tool description overpromises relative to what it
  does) or a real missing capability (some scenario where TaskOutput's delta mode is
  insufficient and true event-push is needed)?
- Should this be one tool (merge Monitor into TaskOutput) or two, matching Claude Code's
  separate-tools shape?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069.
