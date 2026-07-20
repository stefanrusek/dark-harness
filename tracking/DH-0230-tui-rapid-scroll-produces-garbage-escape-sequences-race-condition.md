---
spile: ticket
id: DH-0230
type: bug
status: open
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0126]
  relates_to: [DH-0126]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0230: TUI rapid scroll produces garbage escape sequences (race condition)

## Summary

DH-0126 ("URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history") was largely resolved, and normal-speed scrolling through chat history works without issue. However, during manual testing (2026-07-19), rapid/aggressive scrolling — firing many scroll events in quick succession — still produces some garbage ANSI escape sequences in the rendered output. This appears to be a **timing/race condition** in the scroll event handler or render cycle, rather than a systemic failure. Much improved over the pre-DH-0126 state, but not fully resolved.

## User Stories

### As an operator, I want rapid scrolling to work without producing garbage escape sequences

- Given the TUI is displaying a chat transcript, when I scroll up rapidly by moving the mouse wheel quickly or holding it down, then the transcript should update smoothly without any visible garbage escape sequences, corruption, or visual artifacts.

## Functional Requirements

1. Identify the root cause of the race condition in the scroll event handler (`src/tui/app.ts` or related scroll-handling code)
2. Synchronize scroll event processing with the render cycle to prevent buffered escape codes from being out of sequence
3. Add rate-limiting or debouncing to scroll events if needed to prevent overwhelming the renderer
4. Ensure garbage sequences never appear, even under extreme scroll velocity

## Assumptions

- The pre-DH-0126 fix partially addressed the issue but left a timing vulnerability
- Scroll events may be firing faster than the renderer can process them, causing escape code sequencing issues
- This is likely a buffering/synchronization problem, not a missing escape-code reset

## Risks

- None beyond the normal risk of touching PTY/ANSI rendering code
- Lower priority than DH-0126 since normal scrolling works; only impacts edge-case aggressive scrolling

## Open Questions

- Does debouncing the scroll handler help, or is the issue deeper in the render pipeline?
- Is the problem in Ink's PTY rendering, or in dh's own scroll event binding?

## Notes

### 2026-07-19 — Manual testing observation

During comprehensive TUI testing, observed that:
- Normal scrolling speed: works perfectly ✅
- High-speed/rapid scrolling (quick mouse wheel or hold): produces occasional garbage escape sequences ⚠️
- Much improved vs. pre-DH-0126 state, but not fully eliminated
- Appears to be a **timing/synchronization issue** rather than a logic error

Scenario: Scroll up rapidly through a long chat transcript using the mouse wheel; some ANSI escape sequences appear corrupted in the visible output.

Related: DH-0126 was marked as resolved/verifying after the initial fix, but this edge case remained unaddressed.
