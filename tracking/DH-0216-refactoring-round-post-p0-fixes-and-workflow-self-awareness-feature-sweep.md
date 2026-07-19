---
spile: ticket
id: DH-0216
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0216: Refactoring round: post-P0-fixes and Workflow/self-awareness feature sweep

## Summary

Fourth refactoring round (DH-0141 mechanism). Scoped to commits since DH-0196's closing trailer, covering: DH-0211 (Escape stops agent), DH-0210 (real --import/resume tool-block bug fix), DH-0212/0214 (TUI spike suite triage + genuine wide-char rendering bug), DH-0166 (P0 loopback bind fix, re-derived twice against a fast-moving cli.ts/client-core structure), DH-0213 (Workflow tool research), DH-0215 (agent self-awareness -- session/agent id + log path in system prompt). Several of these landed via stale-worktree re-derivation against heavily-restructured code (the cli.ts split, the sse-client.ts deletion) -- worth checking for residual seams the same way DH-0196 did after the first wave of that. Also worth checking: a ticket-ID collision occurred this round (two isolated worktrees both minted DH-0213 independently) -- the spile-ops minting process may need a documented convention or safeguard for high-concurrency dispatch waves, worth a process-level finding if a clean product fix doesn't cleanly apply.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
