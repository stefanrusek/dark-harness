---
spile: ticket
id: DH-0018
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0001]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0018: `systemPrompt` override silently drops the `TASK_FAILED`/logging/discipline contract, and the prompt lacks guidance for unattended dead-ends

## Summary

A cluster of Prompt-domain gaps in the working-discipline text itself: `config.systemPrompt` is a
full, all-or-nothing override — an operator supplying a custom prompt for a legitimate reason (a
domain persona) unknowingly loses the `TASK_FAILED` self-report convention (on which the entire
exit-code contract, ADR 0006, structurally depends), the escalate/commit/status-supersedes
discipline, and the "everything is auto-logged" notice, with no warning anywhere that this
contract needs re-teaching. Separately, the prompt never mentions `SendMessage`/`TaskStop` in its
working-discipline section (only `Monitor`/`TaskOutput` appear), giving no judgment guidance on
when to steer or stop a stuck/looping sub-agent that nobody is watching. And the "escalate, don't
guess" guidance is written as if a live operator is always reachable to escalate to, with no
bridging language for the primary unattended (`--job`) use case where no one is watching in real
time — the prompt gives no instructed fallback for "stuck, no human available."

## User Stories

### As an operator supplying a custom `systemPrompt`, I want to be warned that I'm responsible for re-teaching the exit-code contract

- Given `config.systemPrompt` is set, when the harness starts, then either the `TASK_FAILED`/
  logging contract is always appended regardless of override, or a startup warning reminds the
  operator that the override is all-or-nothing.

### As a root agent running unattended with no human to escalate to, I want explicit guidance on what "escalate" means when no one can respond

- Given a genuine blocker with no reachable operator, when the prompt's discipline section is
  read, then it distinguishes interactive escalation (wait/ask) from unattended escalation (state
  the issue plainly in final output, proceed with the most reasonable interpretation, or report
  `TASK_FAILED` if no reasonable path exists).

### As an agent, I want guidance on when to `SendMessage`/`TaskStop` a sub-agent rather than just polling it

- Given a sub-agent that's clearly stuck, looping, or needs redirection, when the discipline
  section is read, then it names `SendMessage`/`TaskStop` as the tools for that, not just
  `Monitor`/`TaskOutput`.

## Notes

> [!NOTE]
> Source: Prompt domain sweep findings #5, #7, #8 (systemPrompt override, missing SendMessage/
> TaskStop guidance, missing unattended-dead-end guidance) and #9 (prompt token/cost footprint
> recurring on every agent — noted as a cost-awareness item, not necessarily a bug). Relates to but
> distinct from **DH-0001** (TASK_FAILED marker unreliability even when taught) — this ticket is
> about the harness not teaching the contract at all under a common, legitimate config path,
> plus adjacent discipline gaps in the same file.
