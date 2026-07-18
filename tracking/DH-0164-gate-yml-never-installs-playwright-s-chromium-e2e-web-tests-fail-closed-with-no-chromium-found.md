---
spile: ticket
id: DH-0164
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0164: gate.yml never installs Playwright's Chromium, e2e web tests fail closed with No Chromium found

## Summary

Real, previously-masked CI gap: .github/workflows/gate.yml has never had a Playwright browser install step. e2e/spikes/web/support.ts's resolveChromiumExecutable() checks /opt/pw-browsers/chromium, playwright's own chromium.executablePath(), and a couple of cache paths, but none exist on a fresh GitHub Actions runner since nothing ever runs 'playwright install chromium'. This always existed but was masked because the gate consistently failed earlier (lint/coverage/DH-0070/DH-0146) before execution reached these Chromium-dependent e2e tests. Now that those are all genuinely fixed (100.00% coverage, zero lint errors/warnings, both CI-only test bugs root-caused and fixed), this is the one remaining real blocker to a fully green gate.

## User Stories

### As the e2e gate, I want a Chromium binary available on the runner before any web e2e test runs

- Given a fresh GitHub Actions runner with no prior Playwright cache, when the gate workflow
  runs, then Chromium is installed before the e2e step, and `resolveChromiumExecutable()`
  finds it via `playwright`'s own `chromium.executablePath()` — proven by a real CI run.

## Functional Requirements

- Added an "Install Playwright Chromium" step (`bunx playwright install --with-deps chromium`)
  in `gate.yml`, right after dependency install. `--with-deps` also installs the system
  libraries (fonts, libnss, etc.) `ubuntu-latest` doesn't ship by default.
- Single reusable workflow (`gate.yml`, called by both `ci.yml` and `release.yml`) — one fix
  covers both callers.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Implemented. Local verification limited (this dev machine already has a cached
> Playwright Chromium, so the "fresh runner, nothing cached" failure mode this fix targets
> can't be reproduced locally) — real GitHub Actions CI is the verification of record, per
> this project's established pattern for CI-environment-only issues.

> [!NOTE]
> 2026-07-18 (round 2): Chromium install + tmux install + the 3-way resource-scoped e2e split
> did NOT fix the remaining red `E2E (TUI/PTY — tmux)` step (real CI run 29653054252). Root-
> caused by reading that run's full raw log (`gh run view <id> --log`), not just
> `--log-failed`: EVERY PTY test across all 3 files timed out at the full 30000ms, starting
> with the very first test in the run (`slash-commands.test.ts`'s first case) — not an
> intermittent slow one. tmux itself was fine; the wrapped `dh` process under the real PTY
> never rendered a single frame, so `waitFor` spun for the full timeout, and only *afterward*
> did a stray `capture-pane` (from the next test's setup racing the previous session's actual
> teardown) surface as the misleading "can't find pane"/"no server running" secondary error —
> a symptom of the real failure, not the cause.
>
> Real root cause: Ink (`node_modules/ink/build/ink.js`) imports the `is-in-ci` package and
> checks its module-scope `isInCi` boolean in `onRender` — when true, Ink computes each frame
> but withholds writing it to stdout until `unmount()`, by design (avoids CI log spam from
> repeated ANSI-erase redraws). DH-0146 already found and fixed this exact mechanism for
> `src/tui/app.test.ts` (see `src/tui/ink/render-interactive-in-tests.ts`), but that fix only
> clears `CI`/`CONTINUOUS_INTEGRATION` for that one unit-test process — it never touched
> production. GitHub Actions sets `CI=true` in the job environment; `tmux new-session`
> inherits it into the pane it spawns; the real compiled `dh` binary run interactively under
> that pane is therefore genuinely attached to a real PTY (`isTTY` true) *and* has `CI=true`
> set, and Ink's `is-in-ci` check only looks at the env var, never at whether stdout is
> actually a terminal — so the real interactive TUI silently stopped rendering anything,
> exactly like the DH-0146 unit-test bug, but in production this time.
>
> Fix: `src/tui/app.ts`'s `startTui` (the one call site both `src/cli.ts` and every TUI test
> go through) now deletes `process.env.CI`/`CONTINUOUS_INTEGRATION` immediately before its
> existing `await import("./ink/mount.ts")` — before `ink` (and therefore `is-in-ci`) is ever
> imported for the first time, so the module-scope check always evaluates against a cleared
> env. Safe: `startTui` is only ever called for the real interactive TUI (headless `--job`
> mode never renders Ink), so a real terminal's presence is the only ground truth that
> matters here, not an env var meant to distinguish "is this a CI log" from "is this a real
> terminal" — which under a real PTY (interactively or via tmux in e2e) it always is. Verified
> locally that `CI=true bun test src/tui/app.test.ts` still passes (22 pass/2 skip) since that
> test file's own DH-0146 env-clear already runs first and this change is idempotent with it.
> Pushed for real CI verification.

> [!NOTE]
> 2026-07-18 (round 3): The round-2 fix (deleting `process.env.CI` inside `startTui`'s function
> body in `src/tui/app.ts`) did NOT fix real CI (run 29653565918 — identical failure signature,
> every PTY test still timed out at the full 30000ms). Reproduced locally to find out why:
> built `dist/dh-test` from that commit, ran it under a real local `tmux` session with
> `CI=true` in its env, and `tmux capture-pane` showed only `dh: client connected from ::1`
> and a blank screen — never the "Dark Harness" banner — confirming the underlying `is-in-ci`
> bug was still live even with that delete in place, and that the earlier "verified locally"
> note only ever exercised the *unit test* (which has its own separate, working env-clear via
> `render-interactive-in-tests.ts`), not the actual production render path.
>
> Actual bug: `src/tui/app.ts` already has a **static** top-of-file
> `import { mountInk } from "./ink/mount.ts"` (needed for its type, `InkMount`), and
> `./ink/mount.ts` statically imports `ink`. ESM evaluates a module's static imports before
> any of that module's own code — including function bodies — ever runs. So by the time
> `startTui()`'s function body executed my `delete process.env.CI` line, `ink` (and therefore
> `is-in-ci`, which snapshots the env once at its own import time) had *already* been imported
> and evaluated, as part of evaluating `src/cli.ts`'s import graph at process startup — long
> before `startTui()` is ever called. The `await import("./ink/mount.ts")` a few lines below
> that delete (DH-0145's WASM-ordering fix) is a no-op re-import of an already-loaded module;
> it does not re-trigger `is-in-ci`'s check and never did.
>
> Real fix: added `src/tui/ink/clear-ci-env-for-interactive-render.ts`, a side-effect-only
> module (same shape as DH-0146's `render-interactive-in-tests.ts`, but for production) that
> deletes `CI`/`CONTINUOUS_INTEGRATION` at module-evaluation time. Imported it as the literal
> **first** import statement in `src/cli.ts` (the actual `bun build --compile` entry point per
> `scripts/build.ts`) — ESM evaluates each of an entry module's own top-level import statements
> fully, in source order, before moving to the next one, so this runs to completion before the
> `./tui/index.ts` → `./tui/app.ts` → `./tui/ink/mount.ts` → `ink` chain is ever reached.
> Reverted the now-dead `delete` call in `app.ts`'s `startTui` (left a comment pointing at the
> real fix, so nobody re-adds it there believing it does something).
>
> Re-verified with the exact same manual repro as above (build `dist/dh-test`, real local
> `tmux` session, `CI=true` in the pane's env): `tmux capture-pane` now shows the full rendered
> frame — "Dark Harness — Root Agent — live", the input box, "[Enter] send" footer — exactly
> matching a non-CI run. `bun run typecheck`, `bun run lint`, and `bun test src --coverage`
> (2205 pass, 100% coverage including the new file) all still pass. Pushed for real CI
> verification (this class of bug has now twice looked fixed locally-by-unit-test while still
> broken in the actual production render path, so real CI is the only verification that
> counts here, per this ticket's own established pattern).

> [!NOTE]
> 2026-07-18 (round 4 — closing): Real CI run
> [29653924839](https://github.com/stefanrusek/dark-harness/actions/runs/29653924839) confirms
> `E2E (TUI/PTY — tmux)` GREEN — every test in `tui.test.ts`/`slash-commands.test.ts`/
> `markdown-rendering.test.ts` passed, no timeouts, no `capture-pane`/tmux-server errors. That
> is this ticket's full scope (Chromium install + the tmux/PTY CI-only failure), so closing
> here.
>
> Same run's `E2E (web/browser — Chromium)` step is red, but on a different, unrelated
> failure: headless Chromium launches and gets far enough to hit real DOM assertions
> (`waiting for locator('.dh-app') to be visible` in `web.test.ts`), with a pile of
> `Failed to connect to the bus`/`dbus` errors in its stderr — a sandboxed-headless-Chromium-
> on-a-bare-runner problem (missing D-Bus session, not a `dh`/Ink/tmux issue), out of scope for
> this ticket. Filed as a new follow-up ticket (see DH-0165) rather than folding it in here, so
> DH-0164's own root-caused-and-fixed CI-only bugs aren't reopened by an unrelated one.
