---
spile: ticket
id: DH-0116
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0003]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0116: --server mode's AgentRuntime sessionId mismatches the outer logDir cli.ts uses

## Summary

Found by DH-0003's implementer while building SendMessage-to-finished-agent resume: --server mode's AgentRuntime generates its own internal sessionId independently of the outer session/logDir cli.ts uses for DhServer's logger. So log headers in --server mode already didn't match their directory before DH-0003, pre-existing and out of that ticket's scope. Needs its own investigation into where the two sessionId sources diverge and which one (if either) is authoritative.

## User Stories

### As an operator running `--server` mode, I want log headers to match their directory

- Given `--server` mode is running, when AgentRuntime writes a per-agent JSONL log header,
  then its `sessionId` field equals the name of the `.dh-logs/<sessionId>` directory it's
  written into, so `--resume` (`src/agent/resume.ts`'s `loadHop`) doesn't reject the session
  as inconsistent. Verified by `src/cli.test.ts`: "--server passes the same sessionId to
  createAgentLoop that it reports as its own session".

## Functional Requirements

- The outer session id `src/cli.ts`'s `runMode()` generates (used for `DhServer`'s
  `logDir` and the "session ..." startup line) is authoritative and must be the same id
  `AgentRuntime` stamps into every log header it writes.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — root cause + fix

Root cause: `runMode()` (`src/cli.ts`) generates a `sessionId` via `randomUUID()` and uses
it for `DhServer`'s `logDir` and the "session ..." startup line, but the `AgentRuntime` it
constructs (via `createAgentLoop` → `AgentRuntimeLoopAdapter`) was never given that id —
`AgentRuntime`'s constructor (`src/agent/runtime.ts:305`) falls back to its own
`randomUUID()` when no `sessionId` option is passed. Every log header `AgentRuntime` writes
(`src/agent/loop.ts:463`) therefore carried a different id than the directory `DhServer`'s
`SessionLogger` actually wrote those lines into, which fails `resume.ts`'s `loadHop`
header/directory consistency check (`header.sessionId !== sessionId`) — pre-existing before
DH-0003, as originally reported.

Fix: `runMode()` now generates `sessionId` before constructing the agent loop and threads it
through `createAgentLoop(config, systemPrompt, client, sessionId, resume)` →
`AgentRuntimeLoopAdapter` → `new AgentRuntime({ ..., sessionId })`, making the outer,
directory-determining session id authoritative end to end.
`AgentRuntimeLoopAdapter`'s `sessionId` stays optional (falls back to `AgentRuntime`'s own
`randomUUID()`) so unit tests constructing the adapter directly don't need an unused id.

Changed: `src/cli.ts` (`runMode`, `createAgentLoop` type, `defaultDeps.createAgentLoop`,
`AgentRuntimeLoopAdapter`), `src/cli.test.ts` (updated one existing call site's param
position + added the new regression test above).

Gates: `bun run typecheck` clean; `bun run lint` clean for `src/` (pre-existing failures
only in `.claude/skills/`, untouched by this change); `bun test src` — 2041 pass, 0 fail;
coverage unaffected (`src/cli.ts` 90.20%/99.62%, same uncovered lines as before this change).

Moving to `verifying`.

> [!NOTE]
> **2026-07-17 — Manual verification pass (dh, haiku-bedrock)**
>
> Ran `bun test src` and confirmed DH-0116 test passing:
> - `main — interactive modes > --server passes the same sessionId to createAgentLoop that it reports as its own session` ✅
>
> Implementation verified: `runMode()` now generates `sessionId` before constructing the agent loop
> and threads it through `createAgentLoop()` → `AgentRuntimeLoopAdapter` → `new AgentRuntime({ ..., sessionId })`.
> Log headers now match their directory sessionId end-to-end.
>
> Status: ready for close-out; no blockers found.
