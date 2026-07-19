---
spile: ticket
id: DH-0209
type: bug
status: closed
owner: stefan
resolution: duplicate
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0175]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0209: Sub-agents may lack access to ReportOutcome, falling back to TASK_FAILED confusion

## Summary

Manual testing finding (2026-07-19): in two separate sub-agent test runs, the sub-agent appeared to not know about/have access to the ReportOutcome tool for final status reporting, and failed looking for a nonexistent tool. Needs verification: is ReportOutcome actually registered for sub-agents (not just the root), and if so why did the model behave as if it wasn't available -- could be a prompt-teaching gap (relates to DH-0175's finding that ReportOutcome is registered but never taught in the system prompt) rather than a tool-registration bug. Needs investigation before a fix is scoped.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

**Investigation (2026-07-19):** Checked `src/agent/runtime.ts` tool registration. `ReportOutcome`
is registered once on the `AgentRuntime`'s single shared `toolMap` (constructor, ~line 267:
`if (!this.interactive && !options.tools) { this.toolMap.set(reportOutcomeTool.name,
reportOutcomeTool); }`), keyed only on whether the whole runtime is interactive vs
non-interactive (`--instructions`/`--job` mode) — not per-agent. Both the root's
`runAgentLoop()` call (`runtime.ts` ~line 1016) and every sub-agent's `runAgentLoop()` call via
`spawnAgent()` (`runtime.ts` ~line 697) pass this identical `this.toolMap`. There is no
root-vs-sub-agent asymmetry in tool registration — sub-agents get exactly the same tool set as
root, including `ReportOutcome`, whenever the runtime is non-interactive.

Cross-checked against DH-0175, which already found: `src/prompt/system-prompt.ts`'s
`REQUIRED_CONTRACT` teaches `TASK_FAILED` as the mandatory primary failure convention and does
not mention `ReportOutcome` at all. So the tool is registered but never taught, for every agent
in the runtime (root and sub-agents alike) — this is exactly the same root cause DH-0175 already
documented, not a distinct sub-agent-specific registration bug.

**Conclusion:** DH-0209 is a duplicate confirmation of DH-0175's root cause, observed from a
different angle (manual sub-agent testing) rather than a new/separate bug. No product code
changes made here. The actual fix (teach `ReportOutcome` in the system prompt, demote
`TASK_FAILED`) belongs to DH-0175's own P1/P2/P3 process, already scoped and held pending
prerequisites — not re-implemented in this ticket to avoid duplicating that work.
