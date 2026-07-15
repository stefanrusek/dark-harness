---
spile: ticket
id: DH-0038
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0003]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0038: No crash-recovery/session-resume across a process restart, and a completed standalone job silently starts a fresh, disconnected interactive session

## Summary

Every session gets a fresh `sessionId` and a fresh in-memory `AgentRuntime`; there is no
`--resume <sessionId>` flag and no code path that reconstructs conversation state from an existing
`.dh-logs/<id>` directory. If a container OOMs, is preempted, or the process is killed mid-run, all
agent context (conversation history, partial progress) is lost — for an "hours-long unattended"
primary use case, this is a substantial availability gap; the only recourse today is re-running
`--instructions` from scratch. Separately, and more immediately confusing: after a standalone
`--instructions` run without `--job` completes, `main()` starts a **new**, empty interactive
session rather than continuing the one that just ran — explicitly noted in-code as "not a
continuation" but invisible to the operator watching stdout, who sees the final output print and
then silently gets a fresh, contextless session with no explicit message explaining what happened.

## User Stories

### As an operator, I want a crashed/restarted session to be resumable, not a total loss

- Given a session directory with existing JSONL logs, when `--resume <sessionId>` (or similar) is
  passed, then conversation state is reconstructed from the logs and the run continues.

### As an operator running a standalone job without `--job`, I want to be told explicitly that the follow-up interactive session doesn't share context with the job that just ran

- Given a completed `--instructions` run (no `--job`), when the process continues into interactive
  mode, then it prints an explicit message ("job complete; starting a new session — prior context
  is not preserved") rather than silently swapping to a disconnected session.

## Notes

> [!NOTE]
> Source: dark-factory ops audit findings #9 and #16; independently raised as a capability gap by
> the competitive-differentiation sweep (finding #6, "no session persistence/resume across process
> restart"). Related to but distinct from **DH-0003** (`SendMessage` resuming a *finished-but-
> still-in-process* agent) — this ticket is about surviving a full process restart, not an
> in-process finished-task resume.
