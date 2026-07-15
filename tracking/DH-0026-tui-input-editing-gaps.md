---
spile: ticket
id: DH-0026
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

# DH-0026: TUI's input box has no cursor movement, no bracketed-paste support, and two dead keys

## Summary

The TUI's root input box (`src/tui/state.ts`) only ever appends characters to the end of the
current string and trims the last character on backspace — there is no way to move the cursor
left/right within typed text, no Home/End, no word-delete, and no delete-forward; left-arrow is
entirely reserved for "open agent tree" (only usable when input is empty), so an operator can
never reposition the cursor to fix a mid-string typo, only backspace-and-retype. Compounding this,
there is no bracketed-paste mode support (`src/tui/keys.ts`/`app.ts` never enable or handle it):
pasting multi-line text (e.g. an error log) gets parsed as individual `enter` keystrokes mid-paste,
which sends the partial input as a separate message and clears the box, fragmenting one intended
paste into multiple sent messages — a real, easily-triggered bug for anyone pasting multi-line
content. Two parsed keys (`right`, `Tab`) have no handler anywhere in the reducer and are
currently dead.

## User Stories

### As an operator, I want to move my cursor within the input box to fix a typo without retyping the whole message

- Given typed text in the root input box, when left/right arrow (or Home/End) is pressed with
  non-empty input, then the cursor moves within the text for editing, rather than left-arrow being
  exclusively reserved for tree navigation.

### As an operator, I want to paste multi-line text into the input box as one message, not several

- Given a multi-line paste, when it lands in the input box, then it is treated as literal text
  (via bracketed-paste mode), not as a series of `enter` keystrokes that fragment it into multiple
  sent messages.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #12 through #17 (paste-as-many-keystrokes performance,
> missing bracketed paste causing message fragmentation — the most concrete UX bug in the set — no
> in-text cursor movement, dead `right`/`Tab` keys, unverified IME/composition behavior).
