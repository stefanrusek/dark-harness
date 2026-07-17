---
spile: ticket
id: DH-0120
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0107]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0120: openai-compatible provider omitted required type:function on outgoing tool_calls

## Summary

Live crash found 2026-07-17 testing gemma4 via Bedrock Mantle: after a successful first tool call, the next turn's request (replaying the assistant's prior tool_calls back to the model) failed with HTTP 400 'Invalid tool_calls: missing field type' from Mantle's strict OpenAI-compatible validation. Root cause: toOpenAiMessages() in src/agent/providers/openai-compatible.ts built assistant tool_calls entries as {id, function} with no type field -- the real OpenAI Chat Completions schema requires type: 'function' on each entry. This is a real gap in DH-0107's original implementation, never caught before because it was never live-tested against a real strictly-validating endpoint until Mantle. Fixed: added type: 'function' to both the OpenAiChatMessage type and the two places building tool_calls objects. The existing unit test that exercised this exact code path (openai-compatible.test.ts) previously didn't assert the type field either and would have silently passed a broken request shape -- fixed to assert it now, so this can't regress silently again. Live-verified: re-ran the exact crashing scenario (multi-turn Bash tool call via gemma4/mantle-openai) end to end, now completes successfully (ReportOutcome called, correct result).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
