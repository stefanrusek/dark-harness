---
spile: ticket
id: DH-0210
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0187, DH-0188, DH-0189]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0210: --import + resume chain: toolResult/toolUse block count mismatch crashes the provider request

## Summary

Owner-reported real failure (2026-07-19), reproduced against a real Bedrock haiku model on a real imported Claude Code session: 'dh --import ~/claude-session-backups/test/ --model haiku-bedrock' succeeds at import time, but the resulting session fails on its first turn with 'bedrock provider request failed: The number of toolResult blocks at messages.8.content exceeds the number of toolUse blocks of previous turn.' Confirmed this is a genuine harness bug, not credentials/config -- the error is a real Bedrock API rejection of a malformed message sequence (more tool_result blocks in one message than tool_use blocks in the preceding assistant turn). Notably this specific failure surfaced on a SECOND-level resume (a session that was itself resumed from the original --import session, i.e. 'dh --resume' run twice in sequence) -- the first-level import+resume reportedly completed fine per DH-0188's own round-trip verification (236/236 tool_use/tool_result pairs matched against the fable-july-18-swarm backup), so this may be specific to: (a) src/agent/resume.ts's foldEventsToMessages() double-folding behavior across nested resume chains, not the DH-0188 importer itself, or (b) an edge case in the imported session's actual content shape (e.g. sidechain branches, multi-tool_result messages) that DH-0188's reference backup didn't exercise. Needs real investigation against the owner's actual failing session logs (.dh-logs/3b379af7-30e2-41b1-a1f6-70605c90273a and its resume chain back through e6229b4b-9b16-4c4e-b9b1-9f4b04a5b5f3 to the original import) to find the exact malformed message and root-cause whether it's the importer or the resume-fold path. Core/Server domain -- likely src/agent/resume.ts or src/server/import-claude-session.ts depending on where the malformation is introduced.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
