---
spile: ticket
id: DH-0231
type: bug
status: open
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
