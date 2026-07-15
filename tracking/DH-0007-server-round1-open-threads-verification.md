---
spile: ticket
id: DH-0007
type: bug
status: implementing
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

# DH-0007: Server's three Round-1 open threads — likely stale, never explicitly verified and closed

## Summary

`docs/roster/radia.md`'s Round 1 memory lists three integration open threads: reconciling
`AgentLoopHandle`'s shape against Core's real agent loop, an `EventSource`+bearer-token
escalation question, and a request to confirm Core's `session_ended` self-report behavior.
Given how much has landed and been live-verified since (Core rounds 2 through 13, extensive
real-model testing across the whole build), these are very likely resolved by simple virtue
of the system working end-to-end — but nobody has gone back and explicitly checked and
closed them against current code.

## User Stories

### As a maintainer, I want stale "open thread" notes to either be closed or re-confirmed as real, not just quietly outdated

- Given each of the three open threads, when checked against the current codebase, then each
  is either marked resolved (with the commit/round that closed it) or, if genuinely still
  open, promoted to its own ticket with real detail.

## Notes

> [!NOTE]
> Low-effort verification pass, not a design question — likely a quick close-out, similar to
> how TUI's Round 3 found and corrected a stale "open thread" from its own Round 2.
