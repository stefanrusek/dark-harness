---
spile: ticket
id: DH-0112
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0044]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0112: e2e/support/mock-provider.ts never updated for DH-0044's mandatory streaming -- real turns hang past agent_status

## Summary

e2e/support/mock-provider.ts (the shared mock Anthropic-compatible provider most of the e2e suite imports) still only serves a single non-streaming JSON response per its own comment: 'Only the one endpoint the SDK actually calls (POST /v1/messages, non-streaming)... stream is never set true'. Since DH-0044 made both real provider adapters always request stream: true, any e2e test that exercises a real completed turn through this mock now hangs after agent_spawned/token_usage/agent_status -- confirmed live via bun test e2e/server-protocol.test.ts: 3 of 7 tests fail/timeout waiting for agent_output or a terminal status that never arrives (a second send_message to a waiting root agent, and real sub-agent spawning over HTTP/SSE). This is a different file/domain than the already-fixed src/agent/runtime.test.ts and src/cli.test.ts mock fixtures (Core/Grace's test-only fixtures, fixed same day) -- this is the E2E-owned shared mock (Hedy's domain) and was not touched by that fix. Found by Susan (Web) while investigating an unrelated DH-0066 ticket item, confirmed independently by the coordinator via a direct e2e run.

## User Stories

### As a maintainer, I want the e2e suite to exercise real completed turns, not hang

- Given any e2e test that sends a message and waits for a completed turn (`agent_output`,
  a terminal `agent_status`), when it runs against `e2e/support/mock-provider.ts`, then the
  mock serves a real Anthropic-shaped SSE stream (matching what the real adapter now always
  requests) and the turn completes normally — no hang, no timeout.

## Functional Requirements

- Update `e2e/support/mock-provider.ts` to serve real streaming responses: parse the request
  as always-streaming (per DH-0044, `stream: true` is no longer optional), and emit a real
  `message_start`/`content_block_start`/`content_block_delta`/`content_block_stop`/
  `message_delta`/`message_stop` SSE event sequence instead of a single JSON body.
- Reuse the exact event-construction pattern already built for this same fix in
  `src/agent/providers/anthropic.test.ts` (the adapter's own unit tests) and the just-landed
  `sseMessageResponse()` helpers in `src/agent/runtime.test.ts`/`src/cli.test.ts` — don't
  reinvent the SSE-shape logic a third time; extract/share it if that's cleaner than a third
  copy (E2E's call on whether sharing across `src/` test code and `e2e/` support code is
  practical given this repo's module boundaries).
- Re-run the full `bun run e2e` suite after the fix — confirm `e2e/server-protocol.test.ts`'s
  currently-failing 3 scenarios (second `send_message` to a waiting root, real sub-agent
  spawn over HTTP/SSE) pass, and check for any other e2e file relying on the same mock that
  may have been silently passing only because it never exercised a real completed-turn path.

## Assumptions

- This is a pure test-infrastructure fix — DH-0044's real adapter/loop behavior is already
  correct and live-verified against real Anthropic/Bedrock; only the e2e mock needs to catch
  up to match what the real adapters now send.

## Risks

- Other e2e files beyond `server-protocol.test.ts` may also be silently affected (passing
  today only because they don't exercise a full real-turn completion, or already broken and
  not yet run to completion in this sandbox) — a full `bun run e2e` pass after the fix is the
  only way to know for sure, don't assume `server-protocol.test.ts` is the only casualty.

## Open Questions

## Notes

> [!NOTE]
> Found 2026-07-16 by Susan (Web) mid-investigation of an unrelated DH-0066 item (a real
> Core/Server regression she hit while trying to reproduce a different bug with a real
> browser) — confirmed independently by the coordinator via a direct `bun test
> e2e/server-protocol.test.ts` run: 4 pass, 3 fail, timeouts consistently right after
> `agent_status`, before any `agent_output`. Root-caused to `e2e/support/mock-provider.ts`'s
> own doc comment explicitly stating it never serves streaming responses — confirmed stale
> the moment DH-0044 made streaming mandatory. Filed, not dispatched — new-work dispatch is
> paused 2026-07-16 while the owner works on a separate Slack integration; see the
> `dispatch_paused_2026-07-16` memory note for full context on resuming.

> [!NOTE]
> 2026-07-16 (verifying): Fixed. `e2e/support/mock-provider.ts` now serves real
> `text/event-stream` responses (`message_start`/`content_block_start`/`content_block_delta`/
> `content_block_stop`/`message_delta`/`message_stop`) for successful turns, reusing the same
> event-construction pattern as `sseMessageResponse()`
> (`src/agent/runtime.test.ts`/`src/cli.test.ts`) and `streamOf()`
> (`src/agent/providers/anthropic.test.ts`). Also fixed the DH-0033 malformed-response
> (`malformedTurn()`) case for 200-status garbage bodies: since the request now always asks
> for `stream: true`, a bare non-SSE garbage body was silently parsed as an empty, eventless
> stream (turn "succeeds" with no content) instead of erroring — now wrapped as a malformed
> `event: content_block_delta` / `data:` SSE line so the SDK's decoder hits real garbage
> mid-stream and throws, matching a genuinely corrupted upstream stream.
>
> `bun run e2e` after the fix: **30 pass, 5 fail** (up from a baseline of only 9 pass on
> `main` before touching the mock — see the diff's original 3-of-7
> `e2e/server-protocol.test.ts` failures, now down to 6-of-7 passing). All 5 remaining
> failures are one unrelated, pre-existing root cause, not a DH-0044/streaming regression:
> DH-0050's `ReportOutcome` self-report tool nudges a non-interactive turn that ends in plain
> text with an extra reminder turn, which the shared `successTurn()`/`taskFailedTurn()` mock
> helpers (`e2e/support/mock-provider.ts`, and `mock-bedrock-provider.ts`'s `successTurn()`)
> never account for — doubling `callCount` and, for a few exit-code assertions, producing the
> wrong exit code. Confirmed independent of this ticket via `git stash` against the pre-fix
> mock: the same nudge/exit-code mismatch was already present on `main`, just masked by the
> streaming hang in most cases. Filed as **DH-0115** (ready, unblocked, Hedy/E2E) rather than
> folded in here — different root cause, different fix shape. Affected today: 2 of 4 tests in
> `e2e/exit-codes.test.ts`, 1 of 7 in `e2e/server-protocol.test.ts` (sub-agent-spawn
> scenario), all 3 in `e2e/bedrock-provider.test.ts`.
>
> Verified: `bun run typecheck` clean, `bun run lint` clean for `mock-provider.ts` (repo has
> 9 pre-existing, unrelated lint errors in `.claude/skills/forked-subagent/`, untouched by
> this change).
