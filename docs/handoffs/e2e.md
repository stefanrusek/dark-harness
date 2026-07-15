# Handoff: E2E (real-binary end-to-end tests)

**Addressed to:** the E2E domain lead.
**Owner directory:** `e2e/` (per `CLAUDE.md` §3).
**Status:** OPEN — unblocked 2026-07-15. Core's round 2 (`docs/handoffs/core.md`) landed
real Server/TUI/Web wiring in `src/cli.ts` — verified directly by the coordinator: compiled
`dist/dh --server`, curled a live `GET /api/events` (200) and `POST /api/commands`
(`request_agent_tree` returned a real root-agent node). All four run modes are real, not
stubs. Build against `origin/claude/coordinator-onboarding-kab9ls` HEAD.

---

## Context

Read `CLAUDE.md`, ADR 0008 (coverage + e2e gates), ADR 0004 (security matrix) before
starting. Per `HANDOFF.md` §10, this is real-binary testing — not unit tests with mocks, but
the actual compiled `dh` binary spawned as a subprocess and driven like a real user/operator
would, with the model swapped for a deterministic mock provider.

## Scope

1. **Mock provider endpoint**: an Anthropic-compatible local HTTP server (you can build this
   here, or coordinate with Core if they already stubbed something similar for their own
   tests — check `src/agent/providers/` status first) that returns scripted/deterministic
   responses. This is what makes e2e runs free and deterministic — no real API key needed
   in the gate.

2. **Binary compilation**: `bun run build` produces `dist/dh`. Your suite should build it
   once per run (or reuse a build step from CI) and spawn it as a real OS process for every
   scenario below.

3. **PTY harness for the TUI**: spawn `dist/dh` (local mode) under a pseudo-terminal, drive
   it with real keystrokes, assert on rendered screen content. Bun doesn't have a built-in
   PTY module — you'll need to either shell out to a PTY-capable wrapper or use an FFI/native
   binding; document whichever approach you land on and why.

4. **Headless browser for the web UI**: spawn `dist/dh --web`, drive the served UI with
   Playwright against the pre-installed Chromium (do not run `playwright install`; if the
   pinned `@playwright/test` version differs, launch with
   `executablePath: '/opt/pw-browsers/chromium'`). Assert on the same required-v1 behaviors
   from the Web handoff (status colors, token/cost display, log download, live updates).

5. **Real client↔server over HTTP/SSE across processes**: spawn `dist/dh --server`, then a
   separate `dist/dh --connect <host>` process, and assert the protocol actually works
   across the process boundary — not just in-process like the Server domain's own
   integration tests.

6. **Security matrix** (ADR 0004): unauthenticated client rejected (both POST and SSE) when
   `security.token` is set; authenticated happy path; a TLS client↔server run using a
   self-signed test cert generated for the suite.

7. **Exit-code matrix** (ADR 0006): `--job` mode returns 0/1/2+ correctly across a success
   case, a self-reported-failure case, and a harness-error case (e.g. malformed `dh.json`).

## Constraints

- Stay inside `e2e/`. If a domain's entry point doesn't expose what you need to drive it
  (e.g. no clean way to inject the mock provider URL), that's a request back to that domain,
  not a workaround inside `e2e/`.
- Real-API smoke tests (against the actual Anthropic API) are optional, manual, and **never**
  part of the CI gate — keep them clearly separated if you write any.

## Gates

`bun run e2e` (i.e. `bun test e2e`) is this domain's own gate — it doesn't contribute to the
100%-unit-coverage number, but it must pass in CI per ADR 0008.

## Definition of done (this round)

- Mock provider endpoint exists and is reusable across scenarios.
- At least one real-binary scenario passing per run mode (local TUI, `--web`, headless
  `--server` + `--connect`).
- Security matrix and exit-code matrix covered.
- Anything not yet covered (e.g. Windows-specific PTY behavior) named explicitly — this
  suite will likely need more than one round; say what's in v0.1's e2e gate vs. deferred.

## Status log

_(Append dated entries here. Status supersedes.)_

### 2026-07-15 — Round 1 (Hedy): mock provider + real-binary e2e suite, two cross-domain defects found

**Built, all passing against the real compiled `dist/dh` binary** (`bun run e2e` — 18 tests,
5 files, ~5s from a clean rebuild; `bun run typecheck` and `bun run lint` both clean):

- `e2e/support/mock-provider.ts` — an Anthropic-compatible local HTTP server implementing
  just `POST /v1/messages` (the only endpoint `src/agent/providers/anthropic.ts`'s
  `AnthropicProvider` ever calls). Takes a scripted queue of `MockTurn`s (text and/or
  `tool_use` calls, configurable `stop_reason`/usage); repeats the last turn on exhaustion as
  a safety net. Point a `dh.json` `provider[].baseURL` at its `.baseURL` and the real,
  unmodified `AnthropicProvider` drives the whole suite — no code changed in `src/agent/`.
- `e2e/support/build.ts` — builds `dist/dh` once per `bun test e2e` run via a cached
  module-level promise (all test files share it since `bun test` runs them in one process).
- `e2e/support/workspace.ts`, `port.ts`, `dh-process.ts` — per-test tmpdir + `dh.json`
  fixture writer, free-port picker (needed because `--server`/`--connect --port` reject `0`,
  unlike the client-side ephemeral servers), and a real-subprocess spawn/wait helper.
- `e2e/support/sse-client.ts` — a from-scratch `fetch`-based SSE client (hand-parses
  `id:`/`data:` records per ADR 0002/`src/server/sse.ts`), deliberately independent of
  `src/tui/sse-parser.ts` / `src/web/client/sse.ts` — this is a black-box test of the wire
  protocol, not a reuse of either client domain's own parser.
- `e2e/support/tmux-pty.ts` — **PTY harness decision: `tmux`, not `node-pty`.** Bun has no
  built-in PTY module and no working native-build toolchain was confirmed available in this
  environment; `tmux` was already present and verified interactively (`tmux new-session -d`
  + `capture-pane`/`send-keys`) to give `dist/dh` a genuine pseudo-terminal (real
  `process.stdout.columns/rows`, real raw-mode stdin) rather than a pipe. Documented per the
  handoff's "document whichever approach you land on and why."
- Playwright (`playwright`, not `@playwright/test`) launches with an explicit
  `executablePath: "/opt/pw-browsers/chromium"` — the installed `playwright-core@1.61.1`
  pins chromium revision 1228, but the environment's pre-installed browser is revision 1194,
  so the version-matched default download path would 404; the symlink at that path resolves
  straight to the `chrome` binary and works fine headless.

**Test files (what actually runs and passes):**

- `e2e/exit-codes.test.ts` (4 tests) — `--job`/`--instructions` exit-code matrix (ADR 0006):
  self-reported success (0), self-reported `TASK_FAILED` (1), malformed `dh.json` JSON (2+),
  and a semantically-invalid config (unknown model reference, 2+).
- `e2e/server-protocol.test.ts` (5 tests) — real `dh --server` process driven by a plain
  `fetch` client across an actual OS process boundary: pre-start `request_agent_tree` (root
  node present with status "waiting" even before any message), unknown-agentId 404,
  a full `send_message` → SSE `agent_spawned`/`agent_output`/`token_usage`/`agent_status`/
  `session_ended` sequence, `Last-Event-ID` resume replaying buffered events, and
  `download_logs` (both per-agent JSONL and the full tar bundle).
- `e2e/security.test.ts` (6 tests) — ADR 0004 matrix against the real server: unauthenticated
  POST/SSE both 401, wrong token 401, authenticated POST+SSE happy path through to
  `session_ended`, a self-signed-cert TLS round trip (reusing `src/server/testdata/test-{cert,key}.pem`
  — confirmed plain `http://` genuinely fails against a TLS-only listener), and TLS+token
  together.
- `e2e/tui.test.ts` (2 tests) — real PTY via tmux. One drives local `dh` (server+TUI in one
  process): boots, alt-screen renders, left-arrow → real `request_agent_tree` round-trip
  populates the tree view with the synthesized root node, keystrokes render in the input box.
  The other spawns a **real second `dh --connect localhost --port <p>` process** against a
  real `dh --server`, proving cross-process SSE rendering live in the actual console client.
- `e2e/web.test.ts` (1 test) — real headless Chromium against `dh --web`: connection pill,
  status-dot colors, live output text, token/cost display, session-ended banner, composer
  visibility, and both log-download buttons.

**Two confirmed cross-domain defects, found specifically because this is real-binary/real-browser
testing (ADR 0008's whole rationale) — not fixed here, out of `e2e/`'s ownership per CLAUDE.md §3:**

1. **Interactive-mode bootstrap deadlock (TUI + Web, blocks every fresh interactive session).**
   Neither `src/tui/state.ts` nor `src/web/client/app.ts` ever learns the root agent's id
   until an `agent_spawned` SSE event arrives — but that event only fires once
   `runAgentLoop` starts, which only happens once an operator sends the *first* message,
   which neither client can do because they don't know the root's id yet.
   `request_agent_tree` *does* return a synthesized root node pre-start (verified directly in
   `server-protocol.test.ts`'s first test — `agentId: "agent-root"`, `status: "waiting"`),
   and the TUI's left-arrow tree view even fetches it, but
   `applyTreeResponse` (`src/tui/state.ts`) never feeds it into `state.rootAgentId`, and the
   Web client never calls `request_agent_tree` at all. Net effect, confirmed live in
   `e2e/tui.test.ts`: type a message, press Enter, get "No root agent yet — please wait."
   forever — a real operator cannot start a fresh `dh`, `dh --web`, or `dh --connect` session
   through its own UI. `e2e/tui.test.ts` and `e2e/web.test.ts` both work around it for their
   own coverage by sending the first `send_message` via a direct API call (learning the
   target the same way the real client does — `/dh-config.json` for Web), then verify
   everything downstream for real. **Requests fix from TUI (Mary) and Web (Susan)** — likely
   a one-line-ish fix each (seed `rootAgentId`/`selectedAgentId` from the
   `request_agent_tree` response, and/or issue it automatically on boot instead of only on
   left-arrow); **Core (Grace)** may also want to weigh in on whether `ROOT_AGENT_ID` should
   become a wire-level constant in `src/contracts/` instead of a Core-internal string both
   clients would otherwise have to hardcode.
2. **Missing `Access-Control-Expose-Headers: Content-Disposition` (Server, breaks the web
   log-download filename).** `src/server/server.ts`'s `CORS_HEADERS` never exposes
   `Content-Disposition`, so a real cross-origin browser `fetch` (the web UI and the dh
   server are different origins even in local `--web` mode per ADR 0003) can't read it —
   `src/web/client/download.ts`'s `filenameFromContentDisposition` always falls back to a
   generic client-computed name. For per-agent downloads this coincidentally matches
   (`${agentId}.jsonl`), masking the bug; for the full-session bundle it doesn't — every
   session's bundle downloads as the same generic `dh-session-logs.tar.gz` instead of the
   real `session-<sessionId>.tar`, losing the session id and implying (wrongly, via the
   `.gz` suffix) gzip compression. `e2e/web.test.ts` asserts the actual current filenames
   (documented inline) so the suite stays honest rather than asserting the intended
   behavior. **Requests a one-line fix from Server (Radia):** add
   `Access-Control-Expose-Headers: Content-Disposition` (and any other headers the download
   flow needs) to `CORS_HEADERS`.

**Explicitly deferred/unverified this round (no silent truncation, CLAUDE.md §8):**

- Sub-agent spawning (`Agent` tool) / nested agent-tree rendering — every scenario here uses
  a single-turn root agent; no test scripts a `tool_use` turn, so Bash/Read/Edit/Write tool
  execution and the sub-agent tree UI are not driven end-to-end at all.
- `stop_agent`/TaskStop not exercised.
- Multi-turn conversation with a *second* user message to an already-*completed* root agent
  is not covered — worth flagging separately from defect #1 above: once `runAgentLoop`
  returns after a single no-tool-call turn, `AgentRuntime`'s `sendMessageToRoot` becomes a
  silent no-op (the `pendingMessages` queue it pushes into is never drained again), so this
  may be a related but distinct Core-domain gap worth a look, not just a client bug.
- Windows PTY behavior — the tmux-based harness is Linux/macOS-only; not tested here, as
  flagged as likely out-of-scope-this-round in the original handoff text.
- `--config <path>` (non-default config file location) not explicitly exercised (every test
  relies on the default `dh.json`-in-cwd resolution).
- `bedrock`-type provider not exercised (only `anthropic`-type, via the mock).
- Did not touch or verify `.github/workflows/` (Nightingale's domain) — have not confirmed
  `bun run e2e` is actually wired into the CI gate; worth a cross-check with Nightingale/Ada.
- Parallel/sharded `bun test` execution not stress-tested beyond running all 5 files together
  once; port collisions are mitigated via `findFreePort()` but not adversarially tested.

No changes made outside `e2e/` (mock-provider/build/workspace/port/dh-process/sse-client/tmux-pty
support modules plus the five test files above) and this status-log entry + `docs/roster/hedy.md`.

### 2026-07-15 — Round 2 (Hedy, fresh process): fixed the three Round-5-superseded tests in `server-protocol.test.ts`

Core's Round 5 (`docs/handoffs/core.md`) landed the interactive-session multi-exchange fix
and flagged, as a cross-domain request rather than editing `e2e/` directly, that three tests
in `e2e/server-protocol.test.ts` still encoded the old "one message ends the session"
assumption and would hang/fail. This round is exactly that fix, per the precise diagnosis
already in the handoff (no new investigation needed) — mirroring the pattern Core's own
`src/cli.test.ts` used for the identical problem.

**Fixed, all in `e2e/server-protocol.test.ts`:**

1. `"send_message to agent-root runs a full turn, observable live over SSE"` — now expects
   `agent_status: "waiting"` (not `"done"`) and the tree to read `"waiting"` after one
   message, with no `session_ended` at that point. To actually observe a `session_ended`,
   the test now POSTs `stop_agent` for `agent-root` first, then waits for `session_ended` —
   asserting `exitCode: ExitCode.TaskFailure` (imported from `src/contracts/exit-codes.ts`),
   matching Round 3's "a genuine stop collapses into failed" convention, not `Success`.
2. `"SSE resume via Last-Event-ID replays buffered events"` — swapped its synchronization
   point from `session_ended` (which now never fires after a single message) to
   `agent_status: "waiting"`, on both the original and the Last-Event-ID-resumed connection.
   The test's actual point (does resume replay the same buffered event by id) is unaffected
   by which event type is used as the sync point.
3. `"download_logs: per-agent JSONL and full session tar bundle"` — same swap, waits for
   `agent_status: "waiting"` before hitting `download_logs`; the JSONL/tar shape assertions
   themselves are untouched.

No other test files touched — the other four (`exit-codes.test.ts`, `security.test.ts`,
`tui.test.ts`, `web.test.ts`) don't share this assumption (per Round 5's own note, only
`server-protocol.test.ts` surfaced it, since the tmux/Chromium-dependent files fail on
missing tooling in this sandbox regardless, unrelated to this change).

**Gates:** `bun run typecheck` clean (both TS programs). `bun run lint` clean on
`e2e/server-protocol.test.ts` itself (biome auto-fixed import order/formatting after my
edits); the one remaining lint failure is the pre-existing untracked `dh.json` in the repo
root, present before this round and unrelated to it (same file Round 5's own status log
already noted as pre-existing). `bun test e2e/server-protocol.test.ts` — 5 pass, 0 fail, 22
`expect()` calls. Did not run the full `bun run e2e` — this sandbox has no `tmux`/Chromium,
so `tui.test.ts`/`web.test.ts` fail on missing tooling regardless of this change, per the
task's own scoping.
