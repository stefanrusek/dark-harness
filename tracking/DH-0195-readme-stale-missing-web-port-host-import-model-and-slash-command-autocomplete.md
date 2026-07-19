---
spile: ticket
id: DH-0195
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0195: README stale: missing --web-port, --host, --import/--model, and slash-command autocomplete

## Summary

Owner observation (2026-07-19): README.md's Command-line reference and Quick start sections have not kept up with this session's feature work. Confirmed by grep -- README.md's Command-line reference section (## Command-line reference) already documents --job/--json/--result-only (DH-0147's own Functional Requirements included a docs update, which landed), but has zero mentions of: --web-port <N> (DH-0168), --host <name> (DH-0182), --import <path> / --model <alias> (DH-0187/0188/0189), or the new / slash-command autocomplete dropdown behavior in TUI/Web (DH-0142/0143/0144). Prompt domain (Iris) owns README.md per CLAUDE.md section 3. Scope: add each missing flag to the Command-line reference table (matching the existing table's format/tone), and a short mention of autocomplete wherever the existing docs describe slash commands (search for the current /model, /help, /clear documentation and extend it). Not a redesign of README's structure -- additive entries only, following the existing table/section conventions exactly.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
