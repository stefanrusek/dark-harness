---
spile: ticket
id: DH-0132
type: feature
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

# DH-0132: Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification

## Summary

Owner observation 2026-07-17, prompted by watching a haiku-model sub-agent successfully read and verify a batch of tickets tonight: it's clear this project should be writing some of its acceptance tests as literal prompts sent to a real dh instance via the existing headless dh --job / --json + exit-code mechanism, rather than only unit/integration tests in the traditional sense. This is a process/tooling convention, not a single bug fix -- likely belongs alongside CLAUDE.md 9's existing unit/integration test-tier language as a third tier, or as a documented pattern + example harness script under tracking/ or a new skill. Needs the owner's/Fable's input on scope (is this a new formal test tier, a supplementary verification technique, or specifically tied to the gate-check skill from DH-0113) before it's actionable as a normal implementation ticket.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
