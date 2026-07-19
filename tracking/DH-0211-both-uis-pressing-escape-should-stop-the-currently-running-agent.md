---
spile: ticket
id: DH-0211
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0142, DH-0143]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0211: Both UIs: pressing Escape should stop the currently running agent

## Summary

Owner request (2026-07-19): pressing Escape in either the TUI or Web UI should stop whatever the currently-focused agent is doing (send stop_agent), same convention as many interactive coding-agent UIs. Confirmed via grep: (1) the stop_agent wire command already exists end-to-end (src/contracts/commands.type.ts's StopAgentCommand, handled server-side, same command SendMessage/TaskStop's own harness tools use), so no contracts change is needed; (2) Escape is already a handled key in both UIs today, but only for dismissing the slash-command autocomplete dropdown (DH-0142/0143) and clearing transient status messages/notices -- it never sends stop_agent. Scope: when Escape is pressed AND there is a running agent (the focused/root agent, or whichever agent view is active) AND no higher-priority Escape behavior is already active (e.g. the autocomplete dropdown is open -- that should still close first on the first Escape press, only a second Escape or an Escape with no dropdown open should stop the agent, to avoid accidentally killing a run while dismissing a menu), send stop_agent for that agent. Needs a UX decision on the dropdown-vs-stop precedence and whether a confirmation/undo-window is wanted for something as destructive as stopping a run -- flagged as an open question for whoever implements, not fully speced here.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
