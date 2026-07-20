---
spile: ticket
id: DH-0238
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0226]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0238: ADR number collision: two ADRs both numbered 0009 (colored-span markdown vs Workflow-scripts invariant)

## Summary

docs/adr/0009-markdown-colored-span-subset.md and docs/adr/0009-workflow-scripts-vs-ad-hoc-agents.md both claim ADR 0009 (both accepted 2026-07-19 from the parallel DH-0206/DH-0226 work). ADR numbers must be unique — code cites 'ADR 0009' for both (src/markdown, src/tui, src/web, src/prompt for colored spans; src/agent/tools/workflow.ts + src/agent/workflow/runner.ts for workflow). Renumber one to 0010 and update its citations. Workflow ADR has far fewer citations (2 code sites) so renumbering it is cheapest.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
