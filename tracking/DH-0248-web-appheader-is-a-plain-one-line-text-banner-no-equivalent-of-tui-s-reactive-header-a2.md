---
spile: ticket
id: DH-0248
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0248: Web: AppHeader is a plain one-line text banner, no equivalent of TUI's reactive Header A2

## Summary

Owner live-testing finding (2026-07-20): the Web client's transcript view shows no branded header at launch beyond a thin single-line status bar (AppHeader.tsx: plain DARK HARNESS text + version + config-status line, no color, no monogram). This is by design per DH-0224's rollout note (buildHeaderInfo's logoCompact comment: DARK HARNESS plain-text wordmark fallback is the only single-line brand asset banner.constant.ts exports) -- not a wiring bug, confirmed via a real headless-browser check that the header does render with real (if plain) content. Now that DH-0245 gave the TUI a real, persistent, full-color Header A2 experience in the interactive session, the Web client visibly lags -- the owner expected an equivalent branded moment on launch and instead sees nothing resembling it. The real DH-0219 monogram SVG (LogoMark.tsx, with its green-to-cyan gradient) already exists and is used in the sidebar's brand row -- this ticket is about giving the Web transcript panel its own equivalent 'big header' moment, not just wiring up something that's currently broken.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
