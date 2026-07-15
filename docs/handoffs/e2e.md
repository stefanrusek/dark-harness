# Handoff: E2E (real-binary end-to-end tests)

**Addressed to:** the E2E domain lead.
**Owner directory:** `e2e/` (per `CLAUDE.md` §3).
**Status:** BLOCKED — sequenced after Core, Server, TUI, Web land a working first round.
Do not start until the coordinator moves this to OPEN; it depends on real (not stubbed)
entry points from those domains.

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
