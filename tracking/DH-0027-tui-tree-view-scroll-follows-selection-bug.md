---
spile: ticket
id: DH-0027
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

# DH-0027: TUI's agent tree view doesn't scroll to follow selection — the highlighted entry can scroll off-screen with no way to see it

## Summary

`renderTree` (`src/tui/render.ts`) always shows `tailLines` of the *entire* wrapped tree string —
i.e. it bottom-anchors the view rather than following `selectedIndex`. Moving the selection upward
past the currently visible top does not scroll the viewport; the highlighted `>` marker can scroll
off-screen entirely with no visual feedback about where the selection actually is. For any tree
taller than one screen (plausible in a dark-factory run with many concurrent sub-agents), this is
a real, notable navigation bug, not just a nicety.

## User Stories

### As an operator navigating a tall agent tree, I want the view to scroll so my selection is always visible

- Given a tree taller than the terminal's content rows, when the operator moves selection with
  up/down, then the rendered viewport follows the selection, keeping the highlighted entry always
  on screen.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep finding #20. Marked `ready` — well-scoped, single-file fix in
> `renderTree`'s viewport logic.
