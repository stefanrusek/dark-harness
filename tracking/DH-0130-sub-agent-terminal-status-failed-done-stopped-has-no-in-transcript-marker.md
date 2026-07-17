---
spile: ticket
id: DH-0130
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0130: Sub-agent terminal status (failed/done/stopped) has no in-transcript marker

## Summary

Found during live manual testing 2026-07-17 (owner saw an agent reach a failed state visible only in the sidebar/agent tree, nothing in the chat/transcript pane) and confirmed by code inspection: both TUI and Web's renderTranscript only insert a terminal-status marker for the ROOT agent's session end (the 'Session ended -- exit N' banner). A non-root sub-agent transitioning to failed/done/stopped gets no equivalent marker in its own transcript -- only the sidebar's status color changes. Needs a per-agent transcript marker on terminal status, mirroring the existing root session-end banner pattern. TUI (Mary) + Web (Susan), shared contract shape likely worth a quick Fable check since it may touch src/contracts/events.ts if a new per-agent terminal marker needs its own event, though it's plausible this can be derived client-side from the existing agent_status event without a contract change.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
