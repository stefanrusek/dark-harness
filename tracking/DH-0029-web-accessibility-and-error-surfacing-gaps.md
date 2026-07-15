---
spile: ticket
id: DH-0029
type: bug
status: implementing
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

# DH-0029: Web UI has no keyboard-reachable agent list, no ARIA live regions, a missing "stopped" status color, and both clients drop errors after a few seconds with no history

## Summary

A cluster of Web/TUI operator-experience gaps: the Web sidebar's agent rows are plain `<li>`
elements with only a `click` handler — no `tabindex`/`role`/keydown handling — so the agent tree is
entirely unreachable via keyboard, contradicting HANDOFF §9's "make it a joy to use" for keyboard-
only or accessibility-tool users; there is no `aria-live`/`role="status"`/`role="log"` anywhere, so
a screen-reader user gets no announcement when new output streams in or the connection drops/
reconnects; `styles.css` has no `.status-dot.status-stopped`/`.status-badge.status-stopped` rule
(every other `AgentStatus` has a deliberate color, "stopped" falls back to an unstyled default —
looks like an oversight from when "stopped" was added, and is inconsistent with the TUI which does
color it). Both clients show a transient error banner that auto-hides (Web: fixed 5s) with no
persistent error history/log — a fast operator (or a burst of failures) can miss a real provider
error entirely, and neither client's SSE handling has any path to show *why* an agent went
`failed` (no error-detail text, only the red badge) — an operator has to go find the JSONL log by
hand. Neither client times out/aborts a hung command send, leaving no "still waiting" feedback.

## User Stories

### As a keyboard-only or screen-reader user, I want to navigate and be informed of the agent tree without a mouse

- Given the Web UI's agent sidebar, when navigating via keyboard, then rows are focusable and
  operable with Enter/Space, and live regions announce new output/connection changes.

### As an operator, I want to see why an agent failed, not just a red badge

- Given an agent transitions to `failed` (e.g. a provider error), when viewing it in either client,
  then a human-readable reason is shown, not just the status color.

### As an operator, I want past errors to remain reviewable, not vanish after a few seconds

- Given an error banner has auto-hidden, when the operator wants to review it, then some
  persistent error log/history is available, in both clients.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #19 (undocumented `q` escape key in agent view — minor),
> #25 (missing stopped-status CSS), #27 (Web lacks TUI's "last heard from" staleness signal), #33,
> #34 (transient, easy-to-miss error banners in both clients), #35 (no provider-error detail
> surfaced anywhere), #37 (no timeout/abort feedback on a hung command send), #38 (sidebar rows not
> keyboard-focusable), #39 (no ARIA live regions), #40 (status dot has no `aria-label`, tooltip
> only).
