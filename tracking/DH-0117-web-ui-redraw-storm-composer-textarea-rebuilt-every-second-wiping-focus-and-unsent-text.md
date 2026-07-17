---
spile: ticket
id: DH-0117
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0117: Web UI redraw-storm: composer textarea rebuilt every second, wiping focus and unsent text

## Summary

URGENT, found during live manual testing 2026-07-17: the Web UI's composer textarea was destroyed and recreated on every renderAll() pass. renderAll() runs on every SSE event AND unconditionally every 1s via the DH-0058 liveness timer, so the input box lost focus and any unsent typed text roughly once per second -- unusable for actual typing, blocking manual testing entirely. Root cause: render.ts's renderComposer() did container.textContent = "" + full rebuild on every call with no idempotency check. Fixed same-day: renderComposer now tracks a container.dataset.composerRendered flag and only rebuilds on an actual show/hide transition (switching between root and non-root agent selection), leaving the live textarea's DOM identity/focus/value untouched across repeated renderAll() calls. Two new regression tests added to render.test.ts. Full suite (2096/2096) and typecheck pass.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
