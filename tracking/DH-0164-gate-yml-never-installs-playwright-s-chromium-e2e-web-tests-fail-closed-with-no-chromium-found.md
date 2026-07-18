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
