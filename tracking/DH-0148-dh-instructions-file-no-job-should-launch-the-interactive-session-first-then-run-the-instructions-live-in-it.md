---
spile: ticket
id: DH-0148
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0147]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0148: dh --instructions <file> (no --job) should launch the interactive session first, then run the instructions live in it

## Summary

Owner correction 2026-07-17 (I had the order backwards in conversation): today dh --instructions <file> without --job runs the instructed task once via a separate, invisible AgentRuntime (headless, nothing shown), and only AFTER it completes does it print a notice and start a brand-new interactive TUI/Web session -- explicitly noted in src/cli.ts as a fresh session where prior context is not preserved. The owner wants this reversed: launch the interactive session (TUI or --web) immediately, and have the instructions files content become the first message sent into that live session once the root agent connects -- so the operator watches the instructed task run in real time inside the same session, rather than it happening invisibly first and only getting a disconnected fresh session afterward. This only applies to --instructions without --job (per DH-0147, --job stays the fully headless/exit-on-completion path with its own output-mode flags). runInteractiveMode in src/cli.ts currently has no mechanism to auto-send a first message into a freshly-started session -- its only pre-seeding hook is resumeResult (for --resume, replayed history from a prior session, not a fresh instructions-derived first message). This needs new wiring, likely touching how the TUI/Web client auto-sends its first send_message command once the root agent is confirmed ready (mirroring what a human typing the instructions text as their first message would trigger).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
