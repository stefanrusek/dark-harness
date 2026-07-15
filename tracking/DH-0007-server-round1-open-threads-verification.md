---
spile: ticket
id: DH-0007
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0007: Server's three Round-1 open threads — likely stale, never explicitly verified and closed

## Summary

`docs/roster/radia.md`'s Round 1 memory lists three integration open threads: reconciling
`AgentLoopHandle`'s shape against Core's real agent loop, an `EventSource`+bearer-token
escalation question, and a request to confirm Core's `session_ended` self-report behavior.
Given how much has landed and been live-verified since (Core rounds 2 through 13, extensive
real-model testing across the whole build), these are very likely resolved by simple virtue
of the system working end-to-end — but nobody has gone back and explicitly checked and
closed them against current code.

## User Stories

### As a maintainer, I want stale "open thread" notes to either be closed or re-confirmed as real, not just quietly outdated

- Given each of the three open threads, when checked against the current codebase, then each
  is either marked resolved (with the commit/round that closed it) or, if genuinely still
  open, promoted to its own ticket with real detail.

## Notes

> [!NOTE]
> Low-effort verification pass, not a design question — likely a quick close-out, similar to
> how TUI's Round 3 found and corrected a stale "open thread" from its own Round 2.

## Verification (2026-07-15, Radia)

All three threads checked against current code and confirmed resolved:

1. **`AgentLoopHandle` reconciliation** — resolved via option (b) from the original note:
   `AgentRuntimeLoopAdapter` in `src/cli.ts` bridges Core's `AgentRuntime` to Server's
   `AgentLoopHandle` interface exactly as anticipated (single fixed callback pair ->
   multi-subscriber `onEvent`/`onLog`, plus `sendMessage`/`stopAgent`/`getAgentTree` mapped
   to `AgentRuntime` methods). `src/server/agent-loop.ts`'s interface itself was never
   changed — Core built to it.
2. **`EventSource` + bearer-token escalation** — resolved via option (a) from Radia's
   original escalation: the Web domain dropped native `EventSource` for a `fetch()`-based
   SSE reader (`src/web/client/sse.ts`), which can set the `Authorization: Bearer <token>`
   header on every request including the SSE stream. No query-param-token workaround was
   added; the security posture is untouched. The console TUI (`src/tui/sse-client.ts`)
   independently solved the same problem the same way.
3. **Core's `session_ended` self-report behavior** — confirmed live in
   `src/agent/runtime.ts`'s `runRoot()`: emits exactly one `session_ended` event per run, on
   both the normal-completion path (`exitCode` = `Success`/`TaskFailure` per the loop's
   self-report) and the crash/harness-error path (`exitCode` = `HarnessError`, via a
   try/catch around `runAgentLoop`). Matches the ADR-0006-shaped contract
   `src/server/exit.ts`'s `waitForExitCode` was built against, with test coverage in
   `src/agent/runtime.test.ts` (session_ended assertions around lines 246-272, 739-751,
   1016) exercising all three exit-code cases.

Gates run clean: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (806 pass, 0
fail, 100% coverage on all touched files — no code changes were needed, this was a
read-only verification pass).
