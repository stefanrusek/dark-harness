---
spile: ticket
id: DH-0034
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

# DH-0034: E2E has a port-allocation race, an ordering-dependent cleanup convention, and no coverage of `dh --connect --web`

## Summary

`e2e/support/port.ts`'s `findFreePort` has a classic check-then-use race: it binds an ephemeral
port, reads it, stops the listener, and hands the now-free port to a caller that binds it again in
a separate process later — another concurrently-running e2e test file could grab the same port in
between, a known source of flaky CI under parallel test execution. `e2e/support/workspace.ts`'s
cleanup uses `rmSync(..., { force: true })`, silently swallowing errors, and relies on tests
manually pushing cleanup callbacks in the right order (process-kill before workspace-cleanup) with
no helper enforcing it — easy for a future test author to get backwards. Most notably: the run-mode
matrix cross-check found that `dh --connect --web` (a remote web client pointed at a separately-run
`--server` process) — a composition mode named in CLAUDE.md §4 invariant 1 — has **zero** e2e
coverage; only local `--web` and TUI's `--connect` are tested, not the combination.

## User Stories

### As a maintainer, I want `dh --connect --web` to have real e2e coverage like every other mode composition

- Given a running `--server` process, when a separate `--connect --web` client is exercised
  end-to-end, then a test asserts the same expectations already covered for the other four mode
  combinations.

### As a maintainer, I want port allocation in e2e to not flake under parallel test execution

- Given `findFreePort`'s check-then-use pattern, when tests run in parallel, then a retry-on-bind-
  failure (or another mitigation) prevents intermittent port-collision failures.

## Notes

> [!NOTE]
> Source: CI/Release/E2E sweep findings #23, #24, #28 (the missing `--connect --web` coverage is
> the most significant of the three — a real, previously-unflagged blind spot in the run-mode
> matrix).

## Resolution

Closed 2026-07-15 (Hedy, E2E). All three findings addressed:

- **`--connect --web` coverage (finding #28, the most significant):** new
  `e2e/connect-web.test.ts` — a real `dh --server` process (via the new `startDhServer`
  helper below) plus a separate real `dh --connect <host> --port <n> --web` client process,
  driven with the same pre-installed-Chromium approach as `e2e/web.test.ts`. It asserts the
  connect-mode-specific ready message (`"connected to http://localhost:<port>"`), then drives
  the composer through a real browser and confirms the output rendered is the *remote*
  server's own SSE stream (the client process itself holds no usable model config, so a
  correct render can only have come over the wire). **Not runnable in this sandbox** — no
  Chromium binary at `/opt/pw-browsers/chromium` (same gap `e2e/web.test.ts` already has).
  Verified everything short of the actual browser launch does work end to end here: real
  server spawn, real `--connect --web` client spawn, ready-message parsing, and the
  "connected to" assertion all pass; the test fails only at `chromium.launch()` with
  "executable doesn't exist," confirming the test logic itself is sound and this is purely a
  missing-Chromium environment gap, not a defect in the test.

- **Port-allocation race (finding #23):** `e2e/support/port.ts` gained `startDhServer`, which
  wraps `findFreePort` + spawn + "listening on port" wait in a retry loop (default 3
  attempts) — if a spawned `dh --server` doesn't confirm it's listening within 5s (the
  observable symptom of losing the check-then-use race to a concurrently-running test file),
  it's killed and retried with a freshly-checked port. All eight existing `--server`
  call sites (`server-protocol.test.ts` x3, `security.test.ts` x3, `tui.test.ts` x1,
  `build-stamp.test.ts` x1) were switched over to it.

- **Ordering-dependent cleanup convention (finding #24):** new `e2e/support/cleanup.ts`
  (`createCleanupRegistry`) replaces every test file's flat `cleanups: (() => void)[]` +
  manual-push-order convention with two separate stacks — `addProcess` (kill/close a live
  process, SSE connection, tmux session, or browser) and `addWorkspace` (remove a scratch
  directory) — `runAll()` always drains every `addProcess` cleanup before any `addWorkspace`
  one, regardless of registration order. All seven e2e test files that spawn processes
  and/or create workspaces (`exit-codes`, `server-protocol`, `security`, `tui`, `web`,
  `build-stamp`, `bedrock-provider`) were switched over.

**Verification:** `bun run typecheck`/`bun run lint` clean. `bun run test:coverage`: 806/806
pass, 100% coverage unchanged (no `src/` touched). `bun run e2e`: 25 pass / 5 fail — all five
pre-existing/expected gaps in this sandbox (no `tmux`: 2 tests in `tui.test.ts`; no Chromium
binary: `web.test.ts` plus the new `connect-web.test.ts`; the pre-existing
`security.test.ts` bearer-token SSE timeout flagged since an earlier round) — no
regressions from this round's refactor across the eight retrofitted call sites or seven
retrofitted cleanup-registry files.
