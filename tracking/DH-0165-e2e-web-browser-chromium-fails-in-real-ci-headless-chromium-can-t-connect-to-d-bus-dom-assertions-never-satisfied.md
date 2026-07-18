---
spile: ticket
id: DH-0165
type: bug
status: draft
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

# DH-0165: E2E (web/browser — Chromium) fails in real CI: headless Chromium can't connect to D-Bus, DOM assertions never satisfied

## Summary

Real CI run 29653924839 (branch claude/coordinator-onboarding-kab9ls) shows the web/browser e2e step failing after Chromium and Playwright are correctly installed (DH-0164 fixed that separate issue). Chromium launches headless but stderr is full of "Failed to connect to the bus: Could not parse server address" (D-Bus) and "NameHasOwner" dbus errors; e2e/web.test.ts times out waiting for locator('.dh-app') to be visible, and e2e/streaming.test.ts shows the same launch pattern. Likely needs either a D-Bus session wrapping the test step (e.g. dbus-run-session / xvfb-run) or a Chromium launch flag change in e2e/spikes/web/support.ts. Not yet root-caused beyond this — filed as a follow-up so DH-0164's own fixed CI-only bugs (Chromium install, tmux/PTY Ink-under-CI rendering) aren't reopened by an unrelated failure.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
