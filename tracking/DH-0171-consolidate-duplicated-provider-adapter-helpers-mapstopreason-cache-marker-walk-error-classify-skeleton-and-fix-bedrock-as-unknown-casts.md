---
spile: ticket
id: DH-0171
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0171: Consolidate duplicated provider-adapter helpers (mapStopReason, cache-marker walk, error-classify skeleton) and fix bedrock as-unknown casts

## Summary

anthropic.ts and bedrock.ts carry byte-identical/mirrored helpers plus double-casts masking a typing gap.

## Domain / owner

Core — src/agent/providers/ (Grace)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

- `mapStopReason` is **byte-identical** between `anthropic.ts:128-133` and `bedrock.ts:130-136`.
- Several helpers are documented as "mirrors anthropic.ts's X" (`bedrock.ts:96,160`): the
  `classify*Error` control skeleton, `isContextOverflowMessage` (anthropic.ts:149 /
  bedrock.ts:161), and the cache-marker placement (`withAnthropicCacheMarkers` anthropic.ts:99
  / `withBedrockCacheMarkers` bedrock.ts:101) — parallel implementations never consolidated.
- Genuinely divergent and should stay separate: `toAnthropicContent` vs `toBedrockContent`
  (real wire-shape mapping).
- Related typing smell in the same area: `toBedrockContent` (`bedrock.ts:41-79`) uses four
  `as unknown as BedrockContentBlock` casts that defeat type-checking on the most
  error-prone construction (tool_use/thinking/redacted_thinking). The `BedrockContentBlock`
  alias doesn't model the union the code actually builds. Fixing the union type is in scope
  for this ticket.

Suggested split: a `providers/shared` module for `mapStopReason`, the cache-marker walk,
and the error-classify skeleton; a properly-modeled Bedrock content union to drop the casts.

