---
spile: ticket
id: DH-0177
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

# DH-0177: e2e test-support cleanup: consolidate mock-provider scaffolding and resolve the spikes/ tree's status and gate dependency

## Summary

The two mock providers duplicate chunkText/turn-factories/index-clamp, and gated e2e tests import a helper out of the exploratory spikes/ tree.

## Domain / owner

E2E — e2e/ (Hedy)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169. Two related e2e test-support cleanups:

**A. Mock-provider duplication.** `e2e/support/mock-provider.ts` and
`e2e/support/mock-bedrock-provider.ts` share: `TEXT_DELTA_CHUNK_SIZE = 64` + `chunkText()`
byte-for-byte (mock-provider.ts:87-96 / mock-bedrock-provider.ts:82-90); the four scripted-turn
factories `successTurn`/`taskFailedTurn`/`jobSuccessTurn`/`jobTaskFailedTurn` near-verbatim
(mock-provider.ts:254-288 / mock-bedrock-provider.ts:217-249); and the identical
`if (turns.length===0) throw` guard + `Math.min(callCount, turns.length-1)` index-clamp
with the same `biome-ignore noNonNullAssertion` comment (mock-provider.ts:199-202 /
mock-bedrock-provider.ts:188-191). Extract a shared scaffolding module.

**B. spikes/ tree status + gate dependency.** Real CI-gated tests
(`e2e/web.test.ts:28`, `e2e/streaming.test.ts:22`, `e2e/connect-web.test.ts:18`) import
`resolveChromiumExecutable` from `e2e/spikes/web/support.ts` — a directory whose own header
says it is NOT part of the `bun run e2e` gate. This inverts the dependency direction and
blocks any spikes cleanup. Meanwhile `explore-design-review.ts` is a near-duplicate
maintained in both `spikes/tui/` and `spikes/web/` (shared fixture/config half copy-pasted),
and `spikes/` (14 tui + 13 web files plus committed `artifacts/*.png` + `REPORT.*`) is
largely one-shot DH-0060/DH-0061 verification scaffolding. Promote still-used helpers into
`e2e/support/`, then decide the fate of the rest.

Minor (fold in or drop): `e2e/slash-commands.test.ts:121` proves a negative with a fixed
`Bun.sleep(500)` then asserts `callCount === 0` — flaky/slow; prefer a deterministic signal.

