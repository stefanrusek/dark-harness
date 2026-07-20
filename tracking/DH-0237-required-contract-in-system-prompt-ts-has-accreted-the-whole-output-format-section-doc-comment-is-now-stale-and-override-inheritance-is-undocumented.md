---
spile: ticket
id: DH-0237
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0235]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0237: REQUIRED_CONTRACT in system-prompt.ts has accreted the whole Output-format section; doc comment is now stale and override-inheritance is undocumented

## Summary

src/prompt/system-prompt.ts REQUIRED_CONTRACT is documented as just the TASK_FAILED convention + logging notice, but now also embeds the full '## Output format' section (markdown + colored spans + ASCII art, heavily expanded by DH-0206/0229/0233) and '## Logging'. Because REQUIRED_CONTRACT is always appended after a config.systemPrompt override, operators silently inherit all of that formatting guidance with no doc noting it. Extract the Output-format guidance into its own named constant and make the append-after-override decision explicit, or at minimum correct the doc comment.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
