---
spile: ticket
id: DH-0194
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0148, DH-0147]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0194: Agent should know when running non-interactively (--job) and adjust behavior accordingly

## Summary

Owner observation (2026-07-19), surfaced while scoping DH-0148's interactive-vs-headless distinction: today the model has no way to know whether it's running in --job (headless, no human present) vs an interactive TUI/Web session with a real operator who can answer clarifying questions. The system prompt should tell the agent explicitly when it's in --job mode and instruct it to adjust behavior accordingly -- e.g. never ask a clarifying question and wait for a reply that will never come, make reasonable autonomous judgment calls instead, and generally behave as an unattended batch process rather than an interactive assistant. Likely a Prompt-domain (Iris) change to src/prompt/system-prompt.ts, informed by whether --job's own invocation state is even threaded down to prompt construction today (needs verification during scoping -- may need new plumbing from src/cli.ts to pass an isJob/interactive flag into the prompt builder).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
