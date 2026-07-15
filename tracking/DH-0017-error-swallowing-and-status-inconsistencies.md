---
spile: ticket
id: DH-0017
type: bug
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

# DH-0017: Harness-level errors are silently discarded in one path, and "stopped" vs "failed" agent status can flip depending on event ordering

## Summary

`src/cli.ts`'s lazy-root-start path (`AgentRuntimeLoopAdapter.sendMessage`) catches a failure to
start the root agent (`.catch(() => { ...emit synthetic agent_status: failed... })`) and discards
the actual `Error` object entirely — the real reason (bad config, provider auth failure) never
reaches any log, so an operator sees only an opaque "failed" status with zero diagnostic detail,
exactly the class of failure ADR 0005 exists to make diagnosable. Separately, `TaskRegistry.stop()`
sets a distinct `"stopped"` status on a task record (added specifically to avoid mislabeling a
deliberate stop as a failure), but `runAgentLoop`'s own `agent_status`/`session_ended` emission
still only ever reports `"failed"` for a stop — if the loop's stop-report event fires after
`stop()`'s status change, it can overwrite `"stopped"` back to `"failed"`, and it's unclear which
value the UI-visible status actually ends up showing.

## User Stories

### As an operator, I want the real reason a root agent failed to start to reach the log

- Given a root-agent-start failure, when it occurs, then the actual error message is logged (via
  `onLogLine` or equivalent) before/instead of being silently discarded.

### As an operator, I want a deliberately-stopped agent to always show as "stopped," never "failed"

- Given `TaskStop` is called on a running agent, when its terminal status is reported anywhere
  (JSONL log, SSE event, TUI/Web display), then it consistently reads "stopped," never "failed,"
  regardless of event ordering between the loop and the task registry.

## Functional Requirements

- Given the `AgentStatus` wire type is shared truth (`src/contracts/`), when this is fixed, then
  the fix is coordinated as a contracts-domain change per CLAUDE.md §6 trigger 2.

## Notes

> [!NOTE]
> Source: Core domain sweep findings #13 and #14. Also worth Server/TUI/Web double-checking which
> value actually wins for the UI-visible status of a stopped agent, per the original finding's own
> caveat.
