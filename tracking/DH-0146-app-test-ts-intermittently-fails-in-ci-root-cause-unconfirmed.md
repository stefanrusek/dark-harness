---
spile: ticket
id: DH-0146
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0126, DH-0145]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0146: src/tui/app.test.ts intermittently fails in real GitHub Actions CI -- root cause still unconfirmed

## Summary

Blocked the v0.1.0-alpha.1 release gate intermittently. Real symptom (seen 2026-07-17, GitHub Actions ubuntu-latest runners, multiple separate release-workflow runs): src/tui/app.test.ts assertions expecting rendered text/ANSI content (e.g. 'stopping session', 'child says hi') instead see only the raw startup preamble escape sequences (alt-screen enable, hide-cursor, bracketed-paste, SGR mouse-mode-enable), and two call-count assertions see exactly 2 writes instead of >2 -- consistent with Ink's first real render landing late, after test assertions already fired. Two root-cause theories have been investigated and NEITHER is confirmed: (1) DH-0126 ordering hypothesis -- ruled out, app.ts's alt-screen/mouse-enable/mountInk() sequence is fully synchronous with no scheduler-flippable gap. (2) DH-0145's yoga-layout top-level-await-WASM-vs-Ink's-synchronous-mount race -- a warmup fix (await import of the ink/yoga-layout module graph before any synchronous mountInk() call, commit 29b269e / merged) was implemented and merged, but the SAME exact CI failure recurred afterward on a fresh v0.1.0-alpha.1 tag attempt, meaning either the warmup fix does not actually close the gap, or the real cause is something else entirely. Local reproduction attempts (2026-07-17): could not reproduce on macOS/arm64 in either direction (sometimes crashes in isolation, sometimes passes, no clear signal). Built a Linux/x64 Docker repro (oven/bun:1.3.11 base image, git+ca-certificates installed, git safe.directory configured) matching the CI OS/arch much more closely than the Mac -- ran the exact gate.yml command (bun test src --coverage --parallel=1 --coverage-reporter=text) 7 times: app.test.ts passed cleanly every single time. Instead surfaced a DIFFERENT, real set of container-environment gaps (network/DNS-dependent AnthropicProvider tests, a few known-flaky timing tests) that are NOT the bug being chased and are a distinct, lower-priority finding (see Notes). So even a much-closer-to-CI Linux environment did not reproduce the specific app.test.ts failure -- the real GitHub Actions runner has some other property (exact CPU/scheduling constraints, exact bun version/build, something else) not yet replicated locally.

**Unblock actually applied (2026-07-17, revised from the original test.skip plan):** rather than skip the flaky assertions (risking a 100%-coverage-gate break if these tests are the sole coverage for some code paths, and throwing away real signal on shutdown/resize/tree-navigation behavior), `flush()` in app.test.ts was hardened to poll until `stdout.writes` stops growing (up to a 2s ceiling) instead of trusting a single fixed 100ms sleep -- directly targeting the "Ink's render lands late" theory regardless of its true root cause. Verified 3x clean in the Linux Docker repro post-fix (was already passing there pre-fix too, so this does NOT prove it closes the real CI gap -- local repro never reproduced the failure in the first place). This ticket stays open to track real root-cause confirmation; re-open investigation if the CI failure recurs even after this hardening.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Root cause found and fixed 2026-07-18 (Fable, architect-on-call). This is a **genuine
> mechanistic root cause**, not another mitigation — the prior "poll until writes stop
> growing" hardening (2026-07-17) had a real bug in its termination condition that *was* the
> failure:
>
> The `flush()` poll loop captured `lastLength` at loop entry and broke on the **first**
> 100ms interval showing no growth. But at loop entry, `stdout.writes` contains only the
> **synchronous** startup preamble that `startTui` writes inline (alt-screen enter + hide
> cursor + bracketed-paste enable, then the SGR mouse-enable sequences) — Ink's first real
> render write has not landed yet, because Ink's `render()` schedules its write asynchronously
> (throttled log-update on top of yoga-layout WASM init). So "no growth this interval" was
> **indistinguishable from "Ink hasn't started rendering yet"**: on a resource-constrained
> GitHub Actions runner where Ink's initial render takes longer than the fixed 100ms sleep
> preceding the loop, the loop's first check saw no growth, broke immediately, and the
> assertion fired against preamble-only output — exactly the observed symptom
> (`Received: "[?1049h[?25l[?2004h[?1000h[?1002h[?1006h"`). It never reproduced locally
> because a fast machine always flushed Ink's initial render inside that fixed 100ms sleep,
> before the poll loop ever ran. This is the same "GitHub Actions runners are resource-
> constrained enough to stretch a real async gap wide" class DH-0149's concurrency work
> surfaced — here it stretched the render-scheduling gap past the flush's fixed pre-sleep.
>
> Fix (`src/tui/app.test.ts`): `startTui` always mounts Ink and paints at least one frame, so
> a healthy render **must** grow `stdout.writes` past the entry baseline. The poll now keeps
> waiting (up to a 40×100ms ceiling) until it observes that first growth past baseline, and
> only *then* accepts a stable interval as "render settled" — so "not started yet" can no
> longer be misread as "settled". This is deterministic on the mechanism, independent of the
> exact runner speed. Per-file process isolation (DH-0149) already ruled out all cross-file
> module-load-order theories, which is what let this be pinned to app.test.ts's own flush
> timing. Local: typecheck/lint clean, the previously-recurring "root (sonnet)" test and full
> app.test.ts pass across repeated runs (though local never reproduced the failure, so the
> real GitHub Actions run is the actual proof). The two `test.skip`'d resize/tick tests are
> left skipped for now (out of scope for this recurrence; can be revisited separately).

> [!NOTE]
> CORRECTION — the note above was wrong; the flush-timing theory did **not** hold. Pushing the
> flush change triggered a real CI run (2026-07-18) that failed identically, with every failing
> test now hitting the **exact 5000ms test timeout** — proving the render never lands *at all*
> in CI (not "late"), so no amount of polling can help. The **definitive, proven root cause**
> (found by reading `node_modules/ink/build/ink.js`): Ink's `onRender` has a hard
> `if (isInCi) { this.lastOutput = output; return; }` branch — in CI it stores each frame but
> **never writes it to stdout**, flushing only on `unmount()`. `isInCi` comes from `is-in-ci`,
> evaluated once at import time from `process.env.CI` / `CONTINUOUS_INTEGRATION`. So under
> GitHub Actions (`CI=true`) a mounted-but-not-unmounted TUI writes only the synchronous startup
> preamble — exactly the observed `Received: "[?1049h[?25l[?2004h[?1000h[?1002h[?1006h"`. This
> is 100% deterministic on the env var, which is precisely why it never reproduced locally or in
> the Docker repro (neither set `CI`), and it now reproduces on demand locally with
> `CI=true bun test src/tui/app.test.ts` (13 fail without the fix, 0 with it).
>
> Fix: `src/tui/ink/render-interactive-in-tests.ts` — a tiny module imported first by
> app.test.ts that deletes `CI`/`CONTINUOUS_INTEGRATION` before Ink loads, so Ink uses its
> normal interactive path and actually writes frames. Safe because DH-0149's per-file process
> isolation gives app.test.ts its own OS process — no other test file's env is touched. The
> flush-poll hardening from the first commit is kept (it correctly distinguishes "render not
> started" from "settled") but is defensive, not the fix.
>
> **CI-CONFIRMED (2026-07-18, PR #10 run 29643738877):** the app.test.ts preamble-only failures
> are GONE — the file passes in real GitHub Actions CI. The render-timing root cause is closed.
> The CI run now fails on a SEPARATE, pre-existing issue: the coverage gate at 99.76% (31
> uncovered lines across `loop.ts`, `bash.ts`, `web-fetch.ts`, `cli.ts`, `validate.ts`, TUI
> `app.ts`/`App.tsx`/`state.ts` resize/tick paths, and several `__fixtures__`/test-helper
> files). This gap is NOT caused by this fix or DH-0070 — it reproduces locally at the identical
> 99.76% with and without `CI` set, and each uncovered line is genuinely untested even when its
> own test file runs in isolation (verified for `bash.ts:53`). It was simply masked in CI until
> now because the app.test.ts failures aborted the run before the coverage step was reached
> (likely surfaced by DH-0149's coverage-measurement fix). Two of the uncovered TUI clusters
> (`app.ts` resize/tick, `state.ts`) correspond to the two `test.skip`'d resize/tick tests here;
> the resize test now passes reliably once this fix is in, but the tick test still needs its own
> investigation, and the non-TUI lines need separate test authoring across Core/TUI — so the
> coverage gate is its own follow-up work item, not part of this ticket.
