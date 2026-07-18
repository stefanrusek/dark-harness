---
spile: ticket
id: DH-0164
type: bug
status: verifying
owner: stefan
resolution:
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
