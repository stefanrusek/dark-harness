---
spile: ticket
id: DH-0231
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0231: TUI input box does not wrap long lines

## Summary

When a user types a long line of text that exceeds the width of the input box in the TUI, the text does not wrap to a second line. Instead, text either scrolls horizontally off-screen (invisible) or becomes truncated. The input box should dynamically expand to multiple lines as text approaches the right edge, with proper word/character wrapping.

## User Stories

### As an operator, I want long input lines to wrap within the input box

- Given I am typing in the TUI input box, when I type a line of text longer than the box width (e.g., 80+ characters), then the text should wrap to a second (or additional) line within the input box rather than scrolling off-screen or being truncated.
- The input box should expand vertically to show all wrapped content, and I should see the full text I've typed.

## Functional Requirements

1. Configure the input box's flex/layout properties to allow multi-line wrapping
2. Text should wrap at character or word boundaries as appropriate for the available width
3. The input box should expand vertically to accommodate wrapped lines
4. All typed content should remain visible to the operator (no horizontal scroll-off)
5. Input submission and history navigation should work correctly with multi-line input

## Assumptions

- This is likely a flex/grow configuration issue in the input component's Ink/Yoga layout
- The underlying input component supports multi-line rendering; this is a layout/sizing issue

## Risks

- May affect input component height calculation and overall TUI layout if not carefully scoped
- Need to ensure multi-line input doesn't break the submit/history navigation logic

## Open Questions

- Should wrapped input lines stay in edit mode until submitted, or is there a line-continuation character?
- How should history navigation (up/down arrows) work with multi-line input?

## Notes

### 2026-07-19 — Manual testing observation

During comprehensive TUI testing, observed that typing long lines of text causes the input to either:
1. Scroll horizontally off-screen (text becomes invisible)
2. Truncate at the edge of the input box

Expected behavior: text should wrap to multiple lines within the input box, with the box expanding vertically.

Related to layout/sizing of the input component, possibly in `src/tui/app.ts` or the input component's Ink/Yoga configuration.

### 2026-07-19 — Fixed: input row now width-constrained and wraps

Root cause confirmed exactly as assumed: `src/tui/ink/Composer.tsx`'s input row was a
`<Box height={1}><Text>...</Text></Box>` with no `width` and no `wrap` prop. Ink/Yoga sizes an
unconstrained `<Box>` to fit its content, not the terminal — so a long line just grew wider
than the pane (rendered as horizontal scroll-off/truncation in a real terminal) instead of
wrapping. `RootView.tsx` also never passed the pane's known column width down to `<Composer>`
at all.

Fix: `Composer` now takes an optional `cols` prop (default 80, so existing callers/tests keep
working); the input row is `<Box width={cols}><Text wrap="wrap">...</Text></Box>` with the
fixed `height={1}` removed so the box grows to however many wrapped rows are needed.
`RootView.tsx` passes its already-computed `innerCols` through (minus 1 for the composer's
existing `paddingLeft={1}`). Confirmed the underlying `state.input`/`inputCursor` model is a
single logical string with no line breaks inserted by wrapping — only real newlines (e.g. from
bracketed paste) — so history navigation and submission needed no changes; wrapping is purely
`Composer`'s visual layer, exactly the simplest-correct option flagged in the ticket's Open
Questions.

Verified with new `Composer.test.tsx` cases via `ink-testing-library`'s `lastFrame()`: a
120-char run of `"a"` at `cols={40}` (a) appears in full across the wrapped rows (not
truncated), (b) no rendered row of the input area exceeds the 40-col width, and (c) the frame
grows past the old fixed 2-row layout to fit the wrapped rows. A fourth case confirms the
`cols`-omitted default path still renders correctly for callers/tests that don't care about
width.

Gates: `bun run typecheck` clean; `bun run lint` clean; `bun run test:coverage` 145/147 passed,
100% overall line coverage — the 2 failures (`src/tui/mouse.test.ts`, `src/web/client/
app.test.ts`) are concurrent DH-0230 in-progress work in this shared worktree, unrelated to
this ticket's files (`src/tui/ink/Composer.tsx`, `Composer.test.tsx`, `RootView.tsx`, all
passing). `bun run e2e`: `e2e/tui.test.ts`'s PTY boot test times out; confirmed via
`git stash` that it fails identically with this change reverted — a pre-existing sandbox/
build-timing gap (consistent with prior rounds' documented tmux/PTY environment issues), not a
regression from this fix.
