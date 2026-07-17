---
spile: ticket
id: DH-0146
type: bug
status: draft
owner: stefan
resolution:
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
