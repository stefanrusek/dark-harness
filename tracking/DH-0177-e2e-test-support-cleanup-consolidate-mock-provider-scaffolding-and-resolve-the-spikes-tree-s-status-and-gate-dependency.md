---
spile: ticket
id: DH-0177
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

### 2026-07-18 — implemented (A + B core scope)

**A. Mock-provider duplication — resolved.** Added `e2e/support/mock-scaffolding.ts`: the
shared `TEXT_DELTA_CHUNK_SIZE`/`chunkText()`, `requireTurns()` (the empty-script guard), and
`clampTurnIndex()` (the `Math.min(callCount, turns.length-1)` clamp), plus generic
`successTurn`/`taskFailedTurn`/`jobSuccessTurn`/`jobTaskFailedTurn` factories parameterized
over a shared `ScriptedTurnLike` interface. `e2e/support/mock-provider.ts` and
`e2e/support/mock-bedrock-provider.ts` now both import from this module and their own
factory functions just delegate to the generic ones with an explicit type argument
(`MockTurn` / `MockBedrockTurn` respectively) — public API of both mocks is unchanged, only
the duplicated implementation is gone.

**B. spikes/ gate-dependency inversion — resolved for the concrete finding.** Promoted
`resolveChromiumExecutable` out of `e2e/spikes/web/support.ts` into new
`e2e/support/chromium.ts` (the gated tree). `e2e/web.test.ts`, `e2e/streaming.test.ts`, and
`e2e/connect-web.test.ts` now import it from `./support/chromium.ts` instead of reaching into
`spikes/`. `e2e/spikes/web/support.ts` re-exports it from the new location so the existing
spike scripts (`spike-*.ts`) that import it from that module keep working unchanged. This
removes the only dependency the gated suite had on `spikes/`.

**Deferred (not done in this ticket, scope judgment call):** the rest of "decide the fate of
the rest" — the `explore-design-review.ts` duplication between `spikes/tui/` and
`spikes/web/`, and whether the committed `artifacts/*.png`/`REPORT.*` and the bulk of the
one-shot DH-0060/DH-0061 spike scripts should be trimmed or archived — is left open. None of
it blocks the gate (the dependency inversion that did was B's concrete finding, now fixed),
and per standing project guidance this kind of sweep-sourced cleanup with no concrete
incident/ask behind it is better filed as its own follow-up ticket than done speculatively
here. Also deferred: the minor `e2e/slash-commands.test.ts:121` `Bun.sleep(500)` flakiness
note — cosmetic, unrelated to the two findings this ticket was filed for.

**Verification:** `bun run typecheck` green. `bun run lint` fails on this worktree for an
unrelated, pre-existing reason (biome.json uses config keys — `files.ignore`,
`linter.recommended`, override `include` — that the installed Biome 1.9.4 no longer
recognizes; reproduced identically on a clean `git stash` of this ticket's changes, so it
predates this work and is out of e2e's ownership to fix). `bun run test:coverage` green
(2176 pass / 0 fail, coverage unaffected — this ticket only touches `e2e/`). `bun run e2e`
green (38 pass / 0 fail across 11 files), including the three tests whose import was
repointed (`web.test.ts`, `streaming.test.ts`, `connect-web.test.ts`).

