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

### 2026-07-15 — DH-0012 (EventBuffer byte-bound) and DH-0020 (logger robustness/redaction)

**DH-0012, my slice only (EventBuffer):** `EventBuffer` now evicts on total serialized
bytes (default 10MB) in addition to the existing event-count cap (default 1000) — same
oldest-first eviction loop, just also checking `totalBytes` each iteration. Always keeps at
least one event even if it alone exceeds `maxBytes`, so a single oversized chunk can't empty
the buffer to nothing (a fresh connection should still get best-effort replay of the latest
event). Left an explicit doc-comment note: neither `maxSize` nor the new `maxBytes` is wired
through `dh.json` yet — `cli.ts` (Core) always constructs `DhServer` with defaults today.
Threading a `dh.json` knob to `DhServerOptions.eventBufferMaxEvents`/`eventBufferMaxBytes`
at that construction site is a Core follow-through, not a Server edit of `cli.ts` — same
shape as DH-0020's D4 split below. The other three structures in DH-0012 (TaskRegistry,
TUI/Web `agents` maps) are Core/TUI/Web's slices, not touched here.

**DH-0020 (logger write-errors/durability/redaction) — full ticket, per Fable's design
pass:**
- `SessionLogger.append` never throws now: write/fsync failures are caught, the line is
  dropped, and per-file `{droppedCount, lastErrorCode}` state drives a one-time stderr
  failure notice and a one-time stderr recovery notice (with dropped count) on the next
  success. No retry, no buffering — matches the design's rationale that disk-full/perm
  errors don't resolve between adjacent appends.
- Two-tier durability: ordinary lines stay `appendFileSync` (process-crash-safe only);
  `header`/`completed`/`failed`/terminal-`status_change` (`done`/`failed`/`stopped`) lines
  go through `openSync`/`writeSync`/`fsyncSync`/`closeSync` (host-crash-safe). Doc comment
  rewritten to state both tiers and explicitly name what's *not* guaranteed (event-line
  durability across host crash). An fsync failure is caught by the same try/catch as a write
  failure — no separate code path.
- New `src/server/redact.ts`: `redactSecrets(text, knownSecrets)` (known-value exact match
  on the JSON-escaped form, ≥8 chars, applied before the fixed pattern table — sk-ant-,
  generic sk-, AKIA/ASIA, aws_secret_access_key/aws_session_token key=value,
  Authorization header, ghp_-family, JWT, xox-prefixed Slack, AIza Google) and
  `collectConfigSecrets(config)` (pulls `security.token`, every provider `apiKey`, every MCP
  header value — no length filtering there, the ≥8 guard lives in `redactSecrets` so every
  caller gets it uniformly). Redaction happens inside `SessionLogger.append` on the already-
  serialized JSON line, per the design — not in `loop.ts`, and not applied to the live SSE
  stream (deliberate, documented adjacency, not scope creep).
- `SessionLogger`'s constructor now takes an optional `knownSecrets?: readonly string[]`;
  `DhServer`'s options gained `knownSecrets?: readonly string[]` threaded straight to its
  `SessionLogger`. Exported `redactSecrets`/`collectConfigSecrets` from `src/server/index.ts`
  so Core's `cli.ts` can import them (same precedent as `SessionLogger` itself).
- **Core follow-through still needed** (D4, not done here — explicitly not mine per the
  design): `cli.ts` needs to call `collectConfigSecrets(config)` once and pass the result
  into both `DhServer`'s options and the standalone-mode `SessionLogger` it constructs
  directly in `createStandaloneRuntime`. Until that lands, redaction only ever applies the
  pattern table (still real protection, just not the config-secret exact-match layer).

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass; 100% line/
function coverage on `event-buffer.ts`, `logger.ts`, `redact.ts`, `server.ts` (the
changed/new files). No `e2e` re-run this round (no protocol/route surface changed — only
internal Server-owned modules and options).

No new open threads beyond the two Core follow-throughs noted above (both explicitly
scoped as Core's, not mine, per the tickets' own domain assignment).

### 2026-07-15 — DH-0037: log rotation + `dh logs` analysis tool

Built the two DH-0037 pieces that don't depend on DH-0050's `summary.json` design (that
piece is explicitly sequenced after DH-0050's Core round per the ticket's own owner note —
did NOT build a `summary.json` writer this round).

- **`src/server/log-retention.ts`** — `pruneLogDirectories(logsRootDir, config, now,
  excludeSessionId?)`. Config-gated via a new `LogRetentionConfig`
  (`maxAgeMs?`/`maxTotalBytes?`) added to `src/contracts/config.ts`'s `DhConfig` as
  `logRetention?`. Both fields optional and independent; omitting both (including omitting
  the whole key) is a no-op, matching DH-0012's `LimitsConfig` precedent for new knobs
  defaulting off. Age-pruning runs first, then oldest-by-last-write size eviction; the
  session currently being written is always excluded.
- **`src/server/log-analysis.ts`** — `readSessionLogSummaries`/`buildAgentLogTree`/
  `formatSessionLogTree`, wired to a new `dh logs <sessionDir>` CLI subcommand in
  `src/cli.ts` (handled first in `main()`, before flag parsing/config loading, same as
  `--help`/`--version` — it never touches `dh.json`). Reads header lines for the tree shape
  (parent/child) but scans each file's full event lines for status/cumulative
  cost/duration, since HANDOFF §7's "header-only reconstruction" claim covers the tree, not
  per-agent stats. A corrupt/truncated line or file is skipped, not fatal to the whole
  directory's analysis.

**Judgment calls, flagged for a sanity check rather than escalated up front:**

- Treated the `src/contracts/config.ts` addition (`LogRetentionConfig`) as routine, not an
  architect-review trigger — followed the exact shape/precedent DH-0012's `LimitsConfig`
  already established (optional fields, default-off, same doc-comment pattern), rather than
  inventing a new shape. If that judgment call is wrong, it's an easy, isolated revert.
- Touched `src/cli.ts` directly for both the pruning call sites (interactive mode's and
  `createStandaloneRuntime`'s) and the new `logs` subcommand — Core's file, but the ticket's
  own framing anticipated exactly this ("you'll need a small `src/cli.ts` touch-point... your
  call on the cleanest split"). Kept the touch minimal: two near-identical
  `pruneLogDirectories(...)` calls at the existing `logDir` construction sites, and one new
  `if (argv[0] === "logs")` branch in `main()` before flag parsing.

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass — 100% line
coverage on every new/changed file (`log-retention.ts`, `log-analysis.ts`,
`contracts/config.ts`, `config/validate.ts`, `cli.ts`'s changed lines). `bun run e2e`: 27
pass / 5 fail, but all 5 failures are pre-existing/environmental — headless Chromium isn't
installed in this sandbox (`web.test.ts`/`connect-web.test.ts`), and a flaky SSE-reconnect
TUI PTY timeout already tracked separately (DH-0058) — none touch `src/server/`,
`src/cli.ts`, or `src/contracts/config.ts`, the only files this round changed.

No new open threads.

### 2026-07-16 — DH-0067: server operator UX (startup summary, activity feed, CLI polish)

Architect (Fable) design review of the headless/operational surface. Built the full ticket
across `src/server/` and a scoped `src/cli.ts` touch (same precedent as DH-0037's cli.ts
touch — the ticket's own framing anticipated it):

- **`src/server/log-analysis.ts`**: `formatCost` no longer prints the literal `cost=$?` for
  an unpriced agent (read as an unexpanded shell variable) — now `cost=—`. A `running`
  status is qualified (`running (no terminal event seen)`) since `dh logs` reads static
  JSONL after the fact and has no way to confirm a process claiming to be running is still
  alive — deliberately did *not* try to build real liveness detection (nothing in the log
  files themselves could support it), just stopped asserting a fact the tool can't verify.
  Status words colorize on a TTY (reused the TUI's exact green/cyan/red/gray palette),
  plain on a pipe — same gate `dh doctor` now uses. New `listSessionDirectories`/
  `formatSessionList` back `dh logs` with no argument (lists sessions instead of erroring).
- **`src/server/server.ts`**: `GET /` returns a one-line identifying response instead of a
  bare 404. `DhServerOptions` gained `onClientConnect`/`onClientDisconnect` hooks (fired
  once per SSE connection, passed `server.requestIP(req)`) purely so `cli.ts` can print
  "is my TUI even connected?" lines — no wire/contract change, no effect on the connection.
- **`src/cli.ts` (Core's file, scoped touch)**: `--server` startup now prints, after the
  existing byte-stable "listening on port" line: version, an explicit "bound to
  0.0.0.0:<port>" (worth stating outright since `DhServer` never passes a `hostname` to
  `Bun.serve()` — this is the fact the posture note depends on), the resolved
  `.dh-logs/<sessionId>` directory, and a `dh --connect <host> --port <n>` hint. A one-line
  posture note prints whenever neither a bearer token nor TLS is configured
  (`buildStartupPostureNote`). Local/`--web` startup gained the log-directory line after its
  own byte-stable "web UI ready at" line. New `ActivityFeed` class formats one stdout line
  per agent lifecycle transition (spawn / status change with cumulative token+cost / session
  end) for `--server` mode, replacing total silence between startup and shutdown; new
  `--quiet` flag restores the old silence and also suppresses the client connect/disconnect
  lines. SIGTERM/SIGINT shutdown and the `--job` "starting a new interactive session"
  transition notice moved from stderr to stdout — both are normal lifecycle events, not
  failures, and used to render in the same alarming red as a real error in a typical
  terminal/`docker logs` viewer (the ticket's own risk note: fix the styling, not by
  inventing an ANSI layer just to force stderr neutral — moving the *stream* was the
  simpler, equally-correct read of that note, since there's no existing color infra outside
  `src/tui/`). `dh doctor` output (`formatDoctorReport`) gained TTY colorized PASS/FAIL,
  column-aligned model names, and a trailing "N models: X pass, Y fail" summary line.

Judgment calls, flagged rather than escalated (none seemed to cross an ADR/contract line
per CLAUDE.md §6):
- Scoped the activity feed and client connect/disconnect lines to `--server` mode only, not
  local/`--web`/`--connect` — those already have a real client (TUI/web UI) providing
  moment-to-moment feedback, so the "black box" problem the ticket describes is specific to
  headless mode.
- `GET /` still goes through the existing bearer-token auth check (same as every other
  route) rather than being special-cased open — a token-protected server shouldn't leak
  even one identifying line to an unauthenticated probe.
- Dropped a rare-race `try/catch` in `listSessionDirectories` (the per-session-directory
  read) rather than keep defensive code that's both untestable and only ever shields a
  narrow disappearing-directory race — same call CLAUDE.md's coverage gate nudges toward.

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass — 100% line
coverage on every changed file, 100% function coverage on every new export (`ActivityFeed`,
`buildStartupPostureNote`, `formatDoctorReport`, `listSessionDirectories`,
`formatSessionList`). `bun run e2e`: 30 pass / 2 fail — both failures are the pre-existing
missing-headless-Chromium environment issue (`web.test.ts`/`connect-web.test.ts`), unrelated
to this change; every `waitForStdout`-based e2e test (which greps the exact startup
substrings this round extended, never rewrote) passed clean, confirming the byte-stability
requirement held.

Closed DH-0067 (resolution: done) — confident every user story/functional requirement in
the ticket is addressed. No new open threads.

### 2026-07-16 — DH-0089, my piece only (D4 SSE redaction)

Full ticket context/design is Fable's (architect); Core (Grace) already landed D1-D3
(`ToolCallEvent`/`ToolResultEvent` contracts, `loop.ts` emission). This round was just D4:
the live SSE stream needed the same secret-redaction guarantee DH-0020 gave the JSONL log,
since `ToolCallEvent.inputSummary` is a new place tool arguments (e.g. an MCP API key) can
reach the wire.

- New `sanitizeEvent(event, knownSecrets)` in `src/server/redact.ts`: identity for every
  event type except `tool_call`, where it returns a shallow copy with `inputSummary` run
  through the existing `redactSecrets`. Applied at both `agentLoop.onEvent` subscriptions in
  `server.ts` (the `EventBuffer` intake in `start()`, and the live per-connection broadcast
  inside the SSE stream's `start` callback) via a new private `knownSecrets` field on
  `DhServer`, populated from the same `options.knownSecrets` DH-0020 already threads to
  `SessionLogger` — no new config surface, no `cli.ts` touch needed this round since Core's
  earlier `collectConfigSecrets(config)` wiring already reaches `DhServerOptions`.
- Left the documented residual risk (truncation-then-redaction ordering can drop exact-match
  redaction for a secret straddling the 200-char boundary) as accepted, not fixed — matches
  the design's own call.
- Gates all clean: typecheck, lint, `test:coverage` (1549 pass/0 fail, 100% line+function on
  every changed file), `e2e` (30 pass/2 fail — both the long-standing pre-existing
  headless-Chromium sandbox gap, unrelated).

Left DH-0089 open (not closed) — TUI (Mary)/Web (Susan) D5 client rendering and E2E (Hedy)
D6 follow-up still outstanding. No new open threads from this round.

### 2026-07-16 — DH-0022: opt-in `security.hostname` bind-address config field

Owner pre-decided the design (default bind stays 0.0.0.0/all-interfaces; new field is
opt-in, config-only, not a CLI flag) — this round was pure implementation, no ambiguity
to resolve.

- Added `hostname?: string` to `SecurityConfig` (`src/contracts/config.ts`), same
  optional/omit-means-unchanged shape as `token`/`tls`. Validation in
  `src/config/validate.ts` follows the exact `null`-means-unset normalization already used
  for `token`/`tls`.
- Threaded through both `Bun.serve` call sites: `DhServer.start()`
  (`src/server/server.ts`, conditionally spreads `{ hostname }` when
  `this.security?.hostname` is set) and `serveWebUi` (`src/web/server.ts`, new
  `ServeWebUiOptions.hostname` field). `src/cli.ts` passes `config.security` wholesale to
  `createServer` already (existing pattern), and now also passes
  `config.security?.hostname` explicitly at both `serveWebUi` call sites (local `--web` and
  `--connect --web`) since that options type only had a flat `token`, not a whole-`security`
  passthrough.
- Fixed the one place this made an existing doc/output claim stale: the `--server` startup
  line used to hardcode `bound to 0.0.0.0:<port>` — now reads `config.security?.hostname ??
  "0.0.0.0"`. Confirmed this doesn't break the e2e byte-stability contract: the *default*
  case still emits the exact string every `waitForStdout` grep depends on
  (`bound to 0.0.0.0:`); only a config that actually sets `security.hostname` changes it,
  and no e2e fixture does that today.
- Applied this session's new §9 rule (every acceptance criterion needs a real test, not a
  prose "verified manually" claim): both User Story ACs (custom hostname honored; unset
  field byte-for-byte unchanged) have direct tests in `server.test.ts`/`web/server.test.ts`
  (spy on `Bun.serve` to assert the actual option passed — more reliable in CI than trying
  to prove non-reachability over a real non-loopback interface), plus config
  validation/normalization tests and `cli.ts` option-threading + startup-line tests.
- Also touched `src/web/server.ts` and its test file directly (Susan's directory) rather
  than filing a cross-boundary request — the ticket itself explicitly scoped both
  `Bun.serve` call sites to one implementer, and the owner had already green-lit proceeding
  straight to implementation. Flagging here in case Susan wants to review the shape of
  `ServeWebUiOptions.hostname` against her own conventions.

Gates: `bun run typecheck`, `bun run lint`, `bun test src --coverage` all clean (1825 pass,
100% line/function coverage on every changed file: `contracts/config.ts`,
`config/validate.ts`, `server/server.ts`, `web/server.ts`, plus the covered lines of
`cli.ts`). Live-verified against the compiled binary (`bun run build`): `security.hostname:
"127.0.0.1"` binds loopback-only (`lsof` shows `127.0.0.1:<port> (LISTEN)`, not reachable
on `*:<port>`); field omitted still binds `*:<port>` (all interfaces), matching today's
behavior exactly.

Closed DH-0022 (resolution: done). No new open threads.

### 2026-07-16 — DH-0058: verify-and-close (joint round with Mary), no code changes

This ticket was filed 2026-07-15 for a TUI e2e hang on the SSE-reconnect banner, but the
actual fix (commit `6e49ad6`, same day) had already landed — `server.timeout(req, 0)` in
`handleSse` (`src/server/server.ts`) to disable Bun's default 10s idle timeout on SSE
connections, which was killing every connection before the 20s heartbeat (Round 2) could
fire, forcing a spurious reconnect (and the resync banner) on any turn slower than ~10s.
The commit's own message named DH-0058 and explained the mechanism in detail; the ticket
itself just never got transitioned to `closed` afterward. This round was pure
verification: reran `bun test e2e/tui.test.ts` (4x, 2 pass/0 fail every time) and full
`bun run e2e` (2x, 30 pass/2 fail both times — only the pre-existing missing-Chromium
environment gap, unrelated to Server). No code changes. Closed the ticket via
`spile-ops`'s `transition.py`.

Worth remembering for next time a ticket references "root cause of DH-NNNN" in a code
comment: that's a strong signal the fix already shipped and only the ticket's status field
is stale — check `git log -S"DH-NNNN"` before assuming a reported bug is still live.

### 2026-07-16 — DH-0044, my slice only (two pre-approved contract edits + a DH-0012 note)

Joint round with Grace — the design (Fable, 2026-07-15) explicitly pre-approved both
`src/contracts/` edits as part of the architect sign-off itself, so no separate round-trip
was needed. My whole slice:

- `AgentOutputEvent`'s doc comment in `src/contracts/events.ts` (D1): states a single
  assistant turn MAY arrive as many `agent_output` events, clients MUST accumulate. No wire
  shape change — the `chunk` field already existed, this is purely a semantics clarification
  for anyone reading the contract fresh.
- `LogMessageEvent.partial?: true` in `src/contracts/log.ts` (D5): additive/optional, set
  only on a mid-turn-error/stop's accumulated partial text. Same tolerance contract as every
  other optional field in that file.
- A sizing note on `tracking/DH-0012-unbounded-memory-growth-across-harness.md` (D8): once
  streaming lands, `EventBuffer`'s 1000-event count cap represents far less wall-clock
  history than before (one turn can now be 50-1000 events instead of 1) — flagged for
  DH-0012's own implementer to size the count cap accordingly (or lean on the byte cap as
  primary), not implemented here since DH-0012 is a separate ticket with its own owner.

No handler changes — I confirmed the SSE path (`server.ts`'s `EventBuffer`/broadcast/
`sanitizeEvent`) is genuinely event-shape-agnostic, exactly as the design predicted; nothing
in `src/server/` needed to change for an event type that already existed to just arrive more
often.

Gates: `bun run typecheck`/`lint` clean. No new tests needed — both edits are pure type/doc
additions with zero runtime behavior change on the Server side; existing `events.ts`/
`log.ts` consumers (JSON serialization, `EventBuffer`, redaction) already handle unknown/
optional fields correctly by construction (nothing in `src/server/` pattern-matches on every
field of every event type).
