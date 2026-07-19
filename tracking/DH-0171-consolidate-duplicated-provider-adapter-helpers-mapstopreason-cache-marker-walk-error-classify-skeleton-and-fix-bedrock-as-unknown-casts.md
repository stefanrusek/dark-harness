---
spile: ticket
id: DH-0171
type: bug
status: closed
owner: stefan
resolution: done
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

- Given `anthropic.ts` and `bedrock.ts`'s stop-reason mapping, cache-marker placement walk,
  and error-classification return shape, when either adapter runs, then the shared logic lives
  once in `src/agent/providers/shared.ts` and both adapters call it — proved directly by
  `src/agent/providers/shared.test.ts` (`mapStopReason`, `isContextOverflowMessage`,
  `withCacheMarkers`) and indirectly by the full pass of `anthropic.test.ts` / `bedrock.test.ts`
  (stop-reason, cache-header, and error-classification cases unchanged).
- Given `toBedrockContent`'s tool_use/thinking/redacted_thinking construction, when a
  `ProviderContentBlock` of each of those types is converted, then the result is built without
  any `as unknown as BedrockContentBlock` cast (verified by `bun run typecheck` passing with the
  casts removed) and is exercised by `bedrock.test.ts`'s existing tool_use/thinking/
  redacted_thinking round-trip cases.
- Given the two remaining Bedrock casts that are genuinely unavoidable (`t.inputSchema` into
  `DocumentType` — `JsonSchema` has no index signature so it doesn't structurally overlap with
  `DocumentType`; and the thinking passthrough field), each carries an inline comment explaining
  why, per the ticket's "no escape hatches without a comment" requirement.

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

### 2026-07-18 — implemented

Added `src/agent/providers/shared.ts` with `mapStopReason`, `isContextOverflowMessage`
(parameterized by pattern), the `ErrorClassification` return type, and `withCacheMarkers`
(generic cache-marker placement walk — last message + second-to-last user message — taking a
per-provider `mark(content) => content` callback since Anthropic annotates the existing last
block while Bedrock appends a new trailing block). Both `anthropic.ts` and `bedrock.ts` now
import and use these instead of carrying their own copies.

Fixed all four `as unknown as BedrockContentBlock` casts in `toBedrockContent` (tool_use,
thinking, redacted_thinking) and the cache-point block in `withBedrockCacheMarkers` — turns out
`ContentBlock`'s union members only require their own discriminant key, so plain object
literals satisfy the union directly once the surrounding double-cast is removed; the SDK's
`ContentBlock` union didn't actually need remodeling. Also removed the `as unknown as
BedrockTool` cast on the tools mapping. Two casts remain, each with an inline comment: `t.
inputSchema as unknown as DocumentType` (the local `JsonSchema` interface has no index
signature, so it doesn't structurally overlap with `DocumentType` even though the runtime data
is valid JSON) and `... as DocumentType` for the thinking passthrough field (a
`Record<string, unknown>` built locally, same non-overlap reason but doesn't need the
through-`unknown` step).

Added `src/agent/providers/shared.test.ts` with direct unit tests for the three shared helpers.
All four quality gates verified green locally: `bun run typecheck`, `bun run lint`,
`bun run test:coverage` (100% line/function coverage maintained on
`src/agent/providers/{anthropic,bedrock,shared}.ts`; one unrelated pre-existing flaky
timing-based test — `AgentRuntime — DH-0013` — failed once under load and passed clean on
rerun, confirmed unrelated to this change), `bun run e2e` (38/38 pass).

