---
spile: ticket
id: DH-0115
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0050, DH-0112]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0115: e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050

## Summary

e2e/support/mock-provider.ts's successTurn()/taskFailedTurn() helpers (and e2e/support/mock-bedrock-provider.ts's successTurn()) script a plain-text final turn with no tool call, matching the pre-DH-0050 TASK_FAILED-marker-scan convention. Since DH-0050 (ReportOutcome self-report tool), a non-interactive (--job or sub-agent) run that ends a turn with no ReportOutcome call gets exactly one harness-injected REPORT_OUTCOME_NUDGE_MESSAGE reminder turn (src/agent/loop.ts) before falling back to the legacy TASK_FAILED marker scan -- doubling the mock's expected callCount, and for the malformed/error-injection and bedrock exit-code tests, producing wrong exit codes (harness crash / not converging) instead of the expected 0/1.

## User Stories

### As a maintainer, I want non-interactive e2e mock turns to complete in exactly the scripted number of provider calls

- Given a `--job` run or a real sub-agent spawn scripted with `successTurn()`/`taskFailedTurn()`
  (`e2e/support/mock-provider.ts`) or `mock-bedrock-provider.ts`'s `successTurn()`, when the
  turn ends with plain text and no `ReportOutcome` tool call, then the harness's DH-0050
  missed-call nudge fires and injects one extra reminder turn — doubling `callCount` versus
  what the test asserts, and for the malformed/error-injection and Bedrock exit-code tests,
  producing an unexpected exit code (harness crash / non-convergence) instead of 0/1.

## Functional Requirements

- Teach the shared mock helpers (`successTurn()`, `taskFailedTurn()` in
  `e2e/support/mock-provider.ts`; `successTurn()` in `e2e/support/mock-bedrock-provider.ts`)
  to emit a `ReportOutcome` tool_use call (status `success`/`failure` as appropriate) alongside
  the final text block, for non-interactive turns — matching the pattern already used in
  `src/agent/runtime.test.ts`'s `sendMessageToRoot` test (`tool_use` block, `name:
  "ReportOutcome"`, `input: { status, summary }`, `stopReason: "tool_use"`).
- Do not break the same helpers' use in interactive/TUI e2e tests, where `ReportOutcome` is
  never registered as a tool (DH-0050: registered only for non-interactive runtimes) — an
  interactive scripted turn that emits a `ReportOutcome` tool_use would hit an unknown-tool
  error instead. The fix needs to distinguish interactive vs. non-interactive call sites, or
  provide a separate opt-in helper, rather than a blanket change to `successTurn()`.
- Re-run `bun run e2e` after the fix and confirm all of: `e2e/exit-codes.test.ts` (currently
  2 of 4 failing), `e2e/server-protocol.test.ts` (currently 1 of 7 failing — the sub-agent-
  spawn scenario), and `e2e/bedrock-provider.test.ts` (currently all 3 failing) pass, with no
  regression to the currently-passing interactive-mode tests that also use these helpers.

## Assumptions

- This is a pure test-infrastructure fix — DH-0050's real `ReportOutcome`/nudge behavior in
  `src/agent/loop.ts` is already correct and intentional; only the shared e2e mock helpers
  need to catch up to script it.

## Risks

- Other e2e files beyond the three named above may also rely on `successTurn()`/
  `taskFailedTurn()` for non-interactive runs and be silently affected the same way — a full
  `bun run e2e` pass after the fix is the only way to know for sure.

## Open Questions

## Notes

> [!NOTE]
> Found 2026-07-16 while implementing DH-0112 (`e2e/support/mock-provider.ts`'s streaming-shape
> fix for DH-0044). DH-0112's fix made previously-hanging real-completed-turn tests actually
> reach completion, which surfaced this separate, pre-existing, unrelated bug: it was already
> present on `main` before DH-0112 (confirmed via `git stash` against the pre-fix mock — the
> same nudge/exit-code mismatches were already visible wherever the streaming hang didn't mask
> them first), it's just that the streaming hang failed these tests for a different reason
> first. Filed as a separate ticket rather than folded into DH-0112 since it's an unrelated
> root cause (DH-0050's `ReportOutcome` convention vs. DH-0044's mandatory streaming) and a
> materially different fix shape (tool-call scripting vs. SSE-shape serving).

> [!NOTE]
> 2026-07-17 — Fixed via opt-in helpers, not a blanket change: added `jobSuccessTurn()` /
> `jobTaskFailedTurn()` to `e2e/support/mock-provider.ts` and `e2e/support/mock-bedrock-provider.ts`,
> which emit an authoritative `ReportOutcome` tool_use call (status `success`/`failure`)
> alongside the scripted text, matching `src/agent/runtime.test.ts`'s `sendMessageToRoot`
> pattern. `successTurn()`/`taskFailedTurn()` are unchanged and still used as-is by every
> interactive (server/TUI/Web) call site, where `ReportOutcome` is never registered as a tool.
> Updated the three affected non-interactive call sites: `e2e/exit-codes.test.ts` (both
> `--job` tests), `e2e/server-protocol.test.ts` (the sub-agent-spawn scenario's `subProvider`
> only — root stays on `successTurn` since it's interactive), and
> `e2e/bedrock-provider.test.ts` (all three `--job` tests).
>
> Verification: `bun run typecheck` clean. `bun run test:coverage`: 2110 pass / 0 fail.
> `bun run e2e`: `exit-codes.test.ts`, `server-protocol.test.ts`, `bedrock-provider.test.ts`
> now 18/18 pass (was 6 failing pre-fix, matching the ticket's count). Full `bun run e2e` run
> shows 8 remaining failures, all pre-existing tmux-PTY environment issues (`can't find pane`)
> in unrelated TUI test files (`tui.test.ts`, `markdown-rendering.test.ts`,
> `slash-commands.test.ts`) — confirmed identical against unmodified `main` via `git stash`,
> not a regression from this change. `bun run lint` has pre-existing unrelated failures (two
> `.claude/skills/forked-subagent` scripts, `src/agent/providers/openai-compatible.ts`/
> `.test.ts`) not touched by this ticket.
>
> Acceptance-criteria → test mapping (CLAUDE.md §9): the ticket's single User Story
> ("non-interactive e2e mock turns complete in exactly the scripted number of provider calls")
> is proven by `e2e/exit-codes.test.ts`'s `"success: root agent self-reports completion ->
> exit 0"` and `"self-reported failure: ReportOutcome(failure) -> exit 1"` (both assert
> `provider.callCount`), `e2e/server-protocol.test.ts`'s `"Agent tool spawns a real sub-agent:
> SSE events and getAgentTree() show real nesting"` (asserts `subProvider.callCount === 1`),
> and `e2e/bedrock-provider.test.ts`'s three tests (assert `provider.callCount` for the
> success and tool_use cases, exit code 1 for the failure case).
