---
spile: ticket
id: DH-0176
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

# DH-0176: Audit coverage-gate-driven test patterns (branch-free helpers, synthetic empty constructors, giant test files)

## Summary

Several code artifacts exist to satisfy the 100%-line-coverage gate rather than to exercise
behavior (branch-free test helper, synthetic empty constructors, oversized test files).
**Architect decision (Fable, 2026-07-18): APPROVED for implementation with a hard guardrail —
identify and reshape these patterns WITHOUT changing the coverage gate's threshold or
semantics.** The 100%-line gate stays exactly as-is (CLAUDE.md §5, locked). This is a
test-quality/instrumentation-hygiene pass, explicitly not a gate-relaxation pass.

## Domain / owner

Cross-cutting audit (agent/tools tests, server, web tests). Coordinator triages the
per-domain slices to their owners: Core/Grace (`src/agent/**`), Server/Radia (`src/server/**`),
Web/Susan (`src/web/**`). No `src/contracts/` change; no CI-gate change.

## User Stories

- **US1 — Instrumentation quirk fixed once, not per-site.**
  Given the two synthetic empty constructors (`src/web/client/sse.ts:107`,
  `src/server/fake-agent-loop.ts:34`) that exist only so Bun's coverage instrumentation marks
  the synthetic-constructor slot "hit", When the audit lands, Then those `constructor() {}` +
  `biome-ignore noUselessConstructor` workarounds are gone and the classes retain 100% line
  coverage — verified by `bun run test:coverage` still reporting `lines=100.00%` with the
  empty constructors removed.
- **US2 — Branch-free test helper is honest about why.**
  Given `src/agent/tools/test-helpers.ts` documents itself as "kept branch-free so it doesn't
  dilute the 100%-coverage gate", When reviewed, Then any real conditional the helper needs is
  written naturally and covered by an actual assertion (not contorted to avoid a branch),
  verified by the helper's own consuming tests still passing at 100%.
- **US3 — Oversized test files assessed, not blindly split.**
  Given `runtime.test.ts` (~2740 lines) and `loop.test.ts` (~2171 lines), When audited, Then
  each is checked for line-hitting-only tests (tests that execute a line but assert nothing
  meaningful about its behavior); any found are replaced with behavior-asserting tests, and
  the file's coverage contribution is unchanged — verified by `bun run test:coverage` at 100%.
  Size alone is not a defect; no split is required unless it improves behavior coverage.

## Functional Requirements

**GUARDRAIL (locked — CLAUDE.md §5 / §6 item 1). The 100%-line-coverage gate is not in scope
to change.** This ticket must not, under any framing:

1. Lower the coverage threshold (it is 100% of lines, summed LH/LF over `coverage/lcov.info`
   by CI's `gate.yml`; `scripts/test-isolated.ts` produces that file).
2. Change what the gate measures (line coverage) or how it is summed/merged.
3. Add blanket coverage-suppression — no `istanbul ignore`, no per-file lcov exclusions, no
   directory-level instrumentation opt-outs, no "exclude test-adjacent production code from
   coverage" — to make lines disappear from the denominator. Real product lines stay counted.

**Sanctioned changes (the whole scope):**

- Remove the two synthetic empty constructors and let the classes be covered by real
  instantiation. If Bun's instrumentation still phantom-counts a *compiler-synthetic*
  constructor slot after removal, the fix is a single, narrowly-scoped, per-occurrence
  justified exclusion limited strictly to that synthetic slot — never a pattern that could
  hide an authored line. Prefer a code shape that makes the constructor real (a field the
  constructor genuinely initializes) over any exclusion. If neither is achievable without an
  exclusion mechanism that could generalize, that is an architect re-escalation, not a
  judgment the implementer makes alone.
- Reshape `test-helpers.ts` and any line-hitting tests into behavior-asserting tests that
  keep coverage at 100% by testing real behavior, not by chasing lines.
- Report (in the ticket's status log) any place where a genuinely-unreachable or
  genuinely-untestable line is found — that is a signal to delete the dead line, not to
  suppress its coverage.

**Definition of done:** `bun run typecheck`, `bun run lint`, `bun run test:coverage`
(reporting `lines=100.00%`), and `bun run e2e` all pass, with the artifacts above reshaped and
no gate configuration touched. Relates to DH-0149 (per-file process isolation is how coverage
is now collected — the merge step in `scripts/test-isolated.ts` is the current path).

## Notes

Filed by Fable during refactoring round DH-0169. Architect review completed 2026-07-18:
approved with the §5 gate held constant and the guardrail above spelled out in Functional
Requirements. The escalation trigger was "could this weaken the locked gate?" — the answer is
"only if scoped loosely," so the scope is pinned to test/instrumentation hygiene with the gate
explicitly out of bounds. No architect re-escalation needed for the sanctioned work; re-escalate
only if the synthetic-constructor fix turns out to require a generalizable coverage-exclusion
mechanism (see Functional Requirements).

### 2026-07-18 — Implementation complete

**US1 (synthetic empty constructors) — done, no exclusion mechanism needed.** Both
`constructor() {}` + `biome-ignore noUselessConstructor` workarounds are gone:
- `src/web/client/sse.ts` (`SseStreamParser`): `private buffer = ""` field initializer moved
  into a real constructor body (`this.buffer = ""`), field declared `private buffer: string`
  (no initializer). The constructor body now genuinely executes, so Bun counts it as hit
  without any exclusion.
- `src/server/fake-agent-loop.ts` (`FakeAgentLoop`): same pattern — `private tree: AgentTreeNode[] = []`
  field initializer moved into the constructor body (`this.tree = []`), field declared without
  an initializer. Same effect, no exclusion needed. The escalation path in the Functional
  Requirements (generalizable exclusion mechanism) was never triggered — the "genuinely
  initializing field" shape worked for both occurrences.
- Verified: `bun run test:coverage` shows both `src/web/client/sse.ts` and
  `src/server/fake-agent-loop.ts` at 100.00%/100.00% (lines/functions) with the empty
  constructors removed.

**US2 (branch-free helper) — done.** `src/agent/tools/test-helpers.ts`'s header comment
claimed the file was "kept branch-free"; that was already stale — `makeToolContext`'s
`overrides.tasks ?? new TaskRegistry()` is a real conditional, but no test exercised the
`overrides.tasks` (truthy) side before this change. Fixed:
- Rewrote the header comment to state what the fallback is actually for (share one
  `TaskRegistry` across two contexts) instead of the coverage-avoidance framing.
- Added a new test, `test-helpers.test.ts`: "overrides.tasks is used when provided, instead
  of a fresh TaskRegistry" — asserts `ctx.tasks` is the exact passed-in registry and that a
  task started on it beforehand is visible through the context, which now genuinely exercises
  both sides of the `??`.

**US3 (oversized test files) — audited, no split, no line-hitting-only tests found.**
Reviewed `src/agent/runtime.test.ts` (~2740 lines, 93 tests) and `src/agent/loop.test.ts`
(~2171 lines, 66 tests) for tests that execute a line without asserting anything meaningful.
Heuristic sweep (every `test(...)` block contains at least one `expect(...)`, and a spot check
of every `toBe(true)`/`toBeTruthy()`-style assertion) turned up only genuine behavior
assertions (result success, specific event/log-line presence, etc.) — no vacuous
line-hitting-only tests. Per the ticket's own "size alone is not a defect" clause, neither
file was split.

**Guardrail confirmed held.** No change to `.github/workflows/gate.yml`, no coverage
threshold change, no `istanbul-ignore`/lcov exclusion/instrumentation opt-out added anywhere.
`bun run test:coverage`'s summed LH/LF ratio (the same formula `gate.yml` uses) is unchanged
by this ticket's edits — the two new/moved lines in `sse.ts` and `fake-agent-loop.ts` are both
hit, and the pre-existing gap this local sandbox run reports (~99.78%, from
`src/tui/app.test.ts`'s four `test.skip(...)` cases tracked separately under DH-0146 as
"flaky in real CI, root cause unconfirmed") is identical before and after this change —
confirmed by diffing summed LH/LF across a `git stash`-baseline run vs. this branch's run.
Full four-gate results (`typecheck`, `lint`, `test:coverage`, `e2e`) are in the implementer's
report; `lint` fails in this sandbox on a pre-existing `biome.json` schema mismatch
(`"include"` vs. `"includes"` in `src/web/client/components/**/*.tsx` override) unrelated to
this ticket's diff, reproduced identically on a clean `git stash` of these changes.

**Found but out of approved scope:** none. Both synthetic constructors were fixable with the
"genuinely-initializing field" shape the Functional Requirements called for as the preferred
option — no case required escalating to Fable for a generalizable exclusion mechanism.

