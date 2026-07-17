---
spile: ticket
id: DH-0126
type: bug
status: draft
owner: stefan
resolution:
blocked_by: ["blocked on DH-0136 (UI overhaul phase 2: TUI/Ink migration) -- the working fix pattern (see Notes) is Ink-specific, not portable to the current ANSI renderer"]
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133, DH-0136]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0126: URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history

## Summary

Owner-flagged HUGE problem from live manual testing 2026-07-17: using the mouse scroll wheel in the TUI dumps garbage characters into the input textbox instead of scrolling the history/transcript window. The history window fills up fast during real use and currently has no way to scroll it at all. Two things needed: (1) stop scroll-wheel input from being captured/echoed into the text input, (2) implement real scroll support for the transcript/history pane. High-priority usability blocker, TUI domain (Mary).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Fable's revised DH-0133 design (2026-07-17, after reviewing `../privateer`, a sibling Ink
> TUI project) found privateer has already solved this exact bug, in production, under Ink:
> a raw `process.stdin.on('data', ...)` listener running alongside Ink's `useInput`, an
> SGR-1006 mouse-sequence parser (`src/input/mouse.ts`), and an `isLeakedMouseInput()` guard
> that drops mouse-escape fragments before Ink's stripped-ESC input parser can misread them
> as keystrokes -- privateer's own comments describe the exact failure mode this ticket
> reports (digits from a leaked sequence misread as accelerator keystrokes). Also a reusable
> scroll-viewport module (`src/ui/scroll-viewport.ts`) for the transcript-pane half of this
> ticket. This substantially lowers this ticket's risk/effort once DH-0136 lands -- it's a
> known pattern to port, not protocol work to invent from scratch. Not split into an urgent
> standalone fix (as originally considered) since the working solution is Ink-shaped and
> wouldn't transfer to the current hand-rolled ANSI renderer -- stays fully blocked on
> DH-0136, per the owner's original call that this ticket's implementation would be redone
> after the UI overhaul regardless.
