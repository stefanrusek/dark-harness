---
spile: ticket
id: DH-0131
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

# DH-0131: Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event

## Summary

Found during live manual testing 2026-07-17 while investigating the owner's failed-agent report: searched every session log from that night's testing and found zero status_change events with status:"failed" anywhere, despite the owner having visually seen one in the agent tree live. The one located real failure case (Root agent failed to start: ...) was logged only as a plain message (role: system), never as a structured status_change:failed event -- meaning the JSONL log, the diagnostics-critical source of truth per CLAUDE.md 4.4/ADR 0004, is missing the failure transition entirely for at least this code path. Needs investigation into every place an agent can reach a failed/stopped terminal state to confirm which ones do/don't emit a proper status_change log line. Core (Grace) / Server (Radia) depending on where the gap actually is -- diagnostics-critical, should be prioritized above the purely cosmetic items in this batch.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
