---
spile: ticket
id: DH-0200
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: ["DH-0129"]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0200: Web "Jump to Latest" button disappears after mouse-wheel scroll-up, doesn't reappear consistently

## Summary

Scrolling up in the transcript with the mouse wheel makes the "Jump to Latest" button
disappear entirely instead of staying visible; it reliably reappears when new output pushes
the transcript (a content mutation), but not from the scroll gesture itself. Same area as
DH-0129 (autoscroll-only-when-at-bottom) — `src/web/client/components/Transcript.tsx`'s
`stickToBottomRef`/`jumpVisible` state.

## User Stories

### As an operator, I want the "Jump to Latest" button's visibility to track my actual scroll position, not just content mutations

- Given the operator scrolls away from the bottom with the mouse wheel (no new content
  involved), when the scroll event fires, then the "Jump to Latest" button becomes visible.
  - Proven by: `src/web/client/components/Transcript.test.tsx` — "stays put and reveals the
    jump-to-latest button when content grows while scrolled away" (content-driven path,
    pre-existing) plus the new scroll-driven regression case covering the wheel-scroll path
    directly via the `onScroll` handler.
- Given the button is visible after a manual scroll-up and the operator keeps scrolling
  further away from the bottom, when subsequent scroll events fire, then the button does not
  spuriously hide.
  - Proven by: `src/web/client/components/Transcript.test.tsx` — "auto-scrolls to the new
    bottom when content grows while already near the bottom" and "clicking jump-to-latest
    scrolls back to the bottom and hides the button" continue to pass, plus manual
    verification that `onScroll` now sets `jumpVisible(true)` symmetrically with clearing it.

## Functional Requirements

- The transcript's `onScroll` handler is the source of truth for the "Jump to Latest"
  button's visibility whenever the user is the one moving the scroll position: near-bottom
  hides it, away-from-bottom (with a non-empty transcript) shows it — not just clears it.

## Assumptions

- "Away from the bottom" continues to use the existing `NEAR_BOTTOM_THRESHOLD_PX` (48px)
  threshold from DH-0129.

## Risks

- None beyond normal DOM/jsdom scroll-property quirks already worked around in tests.

## Open Questions

- None blocking.

## Notes

- 2026-07-19: Root cause: `Transcript.tsx`'s `onScroll` handler was asymmetric — it only ever
  called `setJumpVisible(false)` (when near the bottom) and relied entirely on the
  content-update effect to call `setJumpVisible(true)`. A manual mouse-wheel scroll away from
  the bottom with no new content arriving never set `jumpVisible` at all; if it had been left
  `false` (e.g. by an earlier near-bottom scroll or transient position), it stayed hidden
  regardless of how far the operator scrolled up afterward, since nothing but new content
  could ever flip it back to visible. Fixed by making `onScroll` itself set
  `jumpVisible(true)` whenever the region is not near the bottom and the transcript is
  non-empty, matching (and superseding, for the manual-scroll case) the content-update
  effect's logic. See `src/web/client/components/Transcript.tsx`'s updated `onScroll` handler
  and inline comment. Verified via `bun run typecheck`, `bun run lint`, `bun run
  test:coverage` (2180 pass, 100.00% lines on all changed files), and `bun run e2e` (38
  pass).
