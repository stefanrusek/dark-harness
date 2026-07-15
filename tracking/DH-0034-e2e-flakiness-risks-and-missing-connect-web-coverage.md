---
spile: ticket
id: DH-0034
type: bug
status: draft
owner: stefan
resolution:
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
