# Roster: Radia — Server domain lead

**Pronouns:** she/her
**Role:** Server domain lead (self-named after Radia Perlman — networking/transport domain)
**Persistence:** persistent
**Owns:** `src/server/`
**Handoffs:** `docs/handoffs/server.md`

## Memory

### 2026-07-15 — first round

Built the HTTP+SSE server, bearer-token/TLS security, JSONL-per-agent logging, log
download (tar), and exit-code wiring. Full detail of what was built is in
`docs/handoffs/server.md`'s status log — this is the durable part worth remembering on top
of that.

**Route contract chosen (not in any ADR/handoff — build against this):**
`GET /api/events` (SSE, honors `Last-Event-ID`), `POST /api/commands` (JSON `ClientCommand`
body). `OPTIONS` answers CORS preflight without auth (preflight requests can't carry custom
headers, so gating it on the bearer token would break the preflight itself).

**Judgment calls and why:**

- Built a dependency-free ustar writer (`tar.ts`) for `download_logs` bundles rather than
  shelling out to a system `tar`/`zip` binary (not guaranteed present on the windows-x64
  release target) or pulling in a package (keeps `dh` genuinely dependency-free).
- Added permissive CORS unprompted, judged as *not* a security-posture change (ADR 0004) —
  it only relaxes the browser same-origin policy, grants no capability a non-browser client
  didn't already have, and doesn't bypass token/TLS admission control. Necessary because
  `dh --connect <host> --web` means the web UI is routinely a different origin than the
  server. Flagged for a sanity check anyway since it's an easy thing to under-think.
- `constantTimeEqual` hashes both sides to a fixed-length digest before
  `crypto.timingSafeEqual` so unequal-length token strings never throw or leak via early
  return.
- SSE resume buffer (`EventBuffer`) is in-memory, count-bounded (default 1000), no disk
  persistence. A reconnect past the buffer's window gets best-effort replay of the current
  window, not an error. Revisit if dark-factory runs turn out to need longer-than-in-memory
  resume windows.

**Bun coverage-instrumentation quirks discovered** (not real coverage gaps — worth knowing
before "fixing" phantom gaps elsewhere in the codebase):
1. The last `case` in a switch where every branch returns can show its closing brace as an
   uncovered line — dropping block braces on cases with no local declarations fixed it.
2. A class with only field initializers and no explicit constructor shows 0/1 function
   coverage on its synthetic constructor even when instantiated constantly — an explicit
   empty constructor (with a `biome-ignore` for `noUselessConstructor`) fixed it.

**Open threads (check whether resolved before assuming still open):**

1. **`AgentLoopHandle`** (`src/server/agent-loop.ts`) is Server's own guess at what Core's
   real `src/agent/loop.ts` will expose (`onEvent`, `onLog`, `sendMessage`, `stopAgent`,
   `getAgentTree`). Needs reconciliation once Core's real loop lands — either the real loop
   implements this shape directly, or `src/cli.ts` adapts between them.
2. **EventSource + bearer-token gap — escalated, not resolved by me.** ADR 0004 requires
   the bearer token on every request including SSE; browsers' native `EventSource` can't
   set custom headers. The Web domain's handoff commits to `EventSource`. I did not
   unilaterally add a query-param-token workaround (that's a security-posture change,
   CLAUDE.md §6 trigger 4) — escalated three options to the coordinator instead. Check
   `docs/handoffs/server.md`'s status log for the full option list before assuming this is
   settled.
3. Requests to Core: wire `waitForExitCode` (`src/server/exit.ts`) and construct/start
   `DhServer` from `src/cli.ts`; confirm the real agent loop emits exactly one
   `session_ended` event with the ADR-0006-shaped `exitCode` when it finishes (`exit.ts`
   was built against the contract type, not a real implementation).

**Deferred, not done:** SSE persistence across restarts, periodic SSE heartbeat/keep-alive
beyond the one-time `: connected` flush comment, rate limiting/connection caps.

### 2026-07-15 — Round 2: periodic SSE heartbeat

Fixed the deferred item above. `handleSse` now sends a `: ping\n\n` comment every 20s
(`DEFAULT_HEARTBEAT_INTERVAL_MS` in `src/server/server.ts`) on every open connection, via
`setInterval`/`clearInterval` in the stream's `start`/`cancel` callbacks — same lifecycle
the existing live-event `unsubscribe` already used, so no new pattern introduced. Full
rationale and test approach are in `docs/handoffs/server.md`'s Round 2 status entry; the
durable bit worth remembering here:

- Added `DhServerOptions.heartbeatIntervalMs` as a test-only override rather than
  hardcoding the interval — same shape as `eventBufferSize`, keeps `server.ts`'s public
  surface testable without a fake-clock dependency.
- Confirmed this is *not* a security-posture or contract change (no new wire type, no new
  route) — no escalation needed, routine coordinator-level fix.
- Still deferred: SSE persistence across restarts, rate limiting/connection caps. The three
  open threads from Round 1 (`AgentLoopHandle` reconciliation, EventSource+bearer-token
  escalation, Core's `session_ended` confirmation) are unrelated to this round and remain
  open — check their status before assuming resolved.

### 2026-07-15 — DH-0007: closing out the three Round-1 open threads

Verification pass (tracking/DH-0007), no code changes. Checked all three threads directly
against current code and closed the ticket (`status: closed`, `resolution: done`):

1. **`AgentLoopHandle`** — Core built to my shape, not the other way around.
   `AgentRuntimeLoopAdapter` in `src/cli.ts` bridges `AgentRuntime`'s single fixed
   `onEvent`/`onLogLine` callback pair to my multi-subscriber `onEvent`/`onLog` interface,
   and maps `sendMessage`/`stopAgent`/`getAgentTree` onto `AgentRuntime`'s real methods
   (`sendMessageToRoot`/`tasks.sendMessage`, `stopRoot`/`tasks.stop`, `getAgentTree`).
   `src/server/agent-loop.ts`'s interface itself is unchanged from what I originally wrote.
2. **EventSource + bearer-token** — Web chose option (a) from my escalated list: dropped
   native `EventSource` entirely for a `fetch()`-based SSE reader
   (`src/web/client/sse.ts`) that can set the real `Authorization: Bearer <token>` header.
   No query-param-token fallback exists anywhere — the security posture I flagged as not
   mine to bend was never bent. TUI independently arrived at the same fetch-based approach.
3. **`session_ended`** — confirmed live in `src/agent/runtime.ts`'s `runRoot()`: exactly one
   `session_ended` event per run on every path (normal self-report success/failure, and the
   crash/harness-error path via try/catch), `exitCode` shaped exactly as `exit.ts` assumed.
   `runtime.test.ts` has direct assertions for all three cases.

Nothing here needed a fix — this was pure confirmation that the integration risk noted at
handoff time paid off cleanly. No new open threads from this pass.

### 2026-07-15 — DH-0019 and DH-0021: SSE backpressure/gap detection, tar long-name fix

Full detail in `docs/handoffs/server.md`'s new status entry — durable bits worth
remembering here:

- Added `ResyncEvent` to `src/contracts/events.ts` (a shared-contracts change) without
  escalating to the architect: the ticket's own acceptance criteria specified the fix
  ("a `gap`/`resync` event is emitted") at triage time, so I treated the shape as already
  decided rather than mine to design. Worth double-checking with the coordinator/architect
  after the fact if that judgment call turns out to be wrong.
- `EventBuffer.getEventsAfter` changed its return shape from a bare array to
  `{ events, gap }` — a breaking change to that method's signature, but it's Server-internal
  (not a `src/contracts/` type), so no cross-domain contract implications.
- New convention: `DhServer`'s SSE stream now funnels every `controller.enqueue()` through
  one `safeEnqueue` helper with a single idempotent `cleanup()` — if a future change adds
  another thing to write to the stream, route it through `safeEnqueue`, don't call
  `controller.enqueue` directly, or it'll bypass both the backpressure check and reliable
  cleanup-on-failure.
- Testing gotcha worth remembering for any future SSE test: a real `fetch()` round-trip to
  a bound port cannot be used to test backpressure/desiredSize-based logic — Bun's HTTP
  transport drains the response stream into the OS socket buffer independently of whether
  the test's own reader calls `.read()`. Had to call the server's private `handleSse`
  directly to get the real, undrained `ReadableStreamDefaultController`. Also: don't trust
  `reader.closed` as a "did it close" check when the reader never drained anything —
  `controller.close()` only stops future enqueues; `closed` doesn't resolve until existing
  queued chunks are actually read out. Had to saturate-then-drain to prove it.
- `buildTar`'s long-name fix uses a content-derived (sha256-based) rename rather than the
  ustar `prefix` field: the prefix field only helps when a long path can be split at a `/`
  directory boundary, which doesn't apply to a single long filename with no separators (the
  actual shape of an over-limit `agentId`-derived entry name).
- Observed, but did not touch: this shared checkout had another agent's uncommitted,
  in-progress work on `src/tui/state.ts`, `src/agent/skills.ts`, and
  `src/agent/tools/read.ts` at the same time (one of which has a pre-existing typecheck
  error, unrelated to Server). Scoped my own gate runs to `src/server/` + `src/contracts/`
  to avoid being blocked by or interfering with that other domain's WIP; ran the full
  `bun test src` once to confirm no cross-domain regression from my changes specifically.

Both DH-0019 and DH-0021 closed (`status: closed`, `resolution: done`); view regenerated.
No new open threads from this round.
