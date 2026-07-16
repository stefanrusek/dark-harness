---
spile: ticket
id: DH-0075
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

# DH-0075: No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions

## Summary

Real Claude Code's AskUserQuestion tool lets the agent pause and ask a human a structured clarifying question mid-task, when a human is actually present (interactive sessions). dh's TUI and Web UIs are both interactive, human-attended surfaces (src/tui/, src/web/), but dh's agent loop has no equivalent -- an agent can only guess or fail rather than pause for operator input. SendMessage/Monitor/TaskOutput are agent-to-agent (or operator-to-agent) tools for sub-agent supervision, not a mechanism for the running agent itself to solicit input from the human operator watching a session.

## User Stories

### As an operator watching a TUI/Web session, I want the agent to ask me a structured question instead of guessing at an ambiguous instruction

- Given an interactive TUI or Web session (a human is actively watching), when the agent
  hits a genuine fork in approach that only the operator can resolve, then it can pause and
  present a structured question (options, not just free text) rather than picking silently
  or failing.
- Given a headless/unattended session (e.g. a dark-factory overnight run, per
  `docs/skills/*dark-factory*`), when the same tool is called, then it degrades sensibly
  (e.g. errors immediately, or auto-picks a default) rather than hanging forever waiting for
  a human who isn't there.

## Functional Requirements

- New tool: `src/agent/tools/ask-user-question.ts`, mirroring real Claude Code's
  AskUserQuestion shape (question text + structured options).
- `src/server/`, `src/tui/`, `src/web/`: needs a delivery path from agent to attached
  human client(s) and back -- likely a new SSE event type in `src/contracts/` for
  "question posted" and a POST command type for "answer submitted." This is a
  `src/contracts/` change, which per Constitution §6.2 requires architect (Fable) sign-off
  before other domains build against it.
- Must define behavior when no human client is attached (headless/`--job` runs) -- should
  not silently hang; needs a timeout or immediate-error fallback path, especially given
  dark-factory-style unattended runs are an established use case for this project.

## Assumptions

- This is a genuinely new wire-protocol surface (question/answer round-trip over SSE+POST),
  not just a new tool -- larger in scope than a tool-only addition, hence draft status and
  the escalation flag below.

## Risks

- Real risk of agents overusing this to avoid autonomous decision-making, undermining the
  "fully unattended mode" dark-factory workflows this project has built out (per
  `sdd:dark-factory-orchestrator`/`sdd:dark-factory-implementor` skills) -- needs prompt
  guidance (Prompt domain, Iris) constraining when it's appropriate to invoke, analogous to
  how real Claude Code's own system prompt scopes AskUserQuestion's use.
- Blocking a headless run indefinitely if a human never attends -- needs a hard timeout/
  fallback design decision up front, not an afterthought.

## Open Questions

- Should this be escalated to the architect before scoping further, per Constitution §6.2
  (contracts change) and §6.6 ("anything the coordinator... notices it is guessing at")?
  Recommend yes.
- What's the fallback behavior in headless/job mode -- hard error, timeout with a default
  answer, or simply unavailable (tool absent from the toolset) in that mode?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. This is one of the larger/more
> speculative findings in the batch -- flagged draft and recommended for architect review
> given the contracts-level surface it implies, unlike the more mechanical tool-parameter
> gaps also filed in this pass.
