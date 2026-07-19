---
spile: ticket
id: DH-0143
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0142]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0143: Web: / commands should autocomplete

## Summary

Owner request 2026-07-17: typing / in the Web composer should offer autocomplete for recognized slash commands. Web domain (Susan). Sibling ticket for the TUI filed separately (dispatch system splits cleanly by UI ownership) -- check for shareable logic (e.g. the underlying command list/matcher, src/web/client/slash-commands.ts already exists and may be a starting point or need extension) once both are scoped.

**Owner decision (2026-07-19):** same design as DH-0142 (TUI sibling) — dropdown list,
filters as you type (arrow keys + Enter/Tab to select), showing each command's name plus a
short description, not names alone.

**Design note:** the command list + description strings + filter-matching logic should live
in `src/client-core/` (established by DH-0183) and be shared with DH-0142's TUI
implementation — only the dropdown rendering/keyboard-interaction layer is genuinely
Web-specific (React component in `src/web/client/`). Check landing order/conflicts against
DH-0142 if worked concurrently; the shared matcher itself is small.

## User Stories

### As a Web user, I want a filtered command list when I type `/`, so I can discover and select commands without memorizing them

- Given the composer is empty and the user types `/`, when the input matches zero or more
  recognized commands, then a dropdown appears listing each matching command's name and a
  short description, updating live as more characters are typed.

### As a Web user, I want to navigate and select from the dropdown with the keyboard

- Given the dropdown is showing, when the user presses Down/Up, then the highlighted entry
  moves accordingly; when they press Enter or Tab, then the highlighted command's name is
  inserted into the composer and the dropdown closes.

### As a Web user, I want the dropdown to close cleanly when it's no longer relevant

- Given the dropdown is open, when the user types a character that matches no command, or
  presses Escape, or the input no longer starts with `/`, or clicks outside the composer,
  then the dropdown closes.

## Functional Requirements

- Command list + descriptions + filter-matching: shared logic in `src/client-core/`, reused
  by DH-0142 (TUI).
- Dropdown rendering + keyboard interaction: Web-specific (React), lives in
  `src/web/client/`.
- No matches: dropdown simply doesn't render (not an error state).

## Assumptions

- The command list to autocomplete against is the same set `src/client-core/`'s
  slash-command parser already recognizes (DH-0183) — no new commands invented here.

## Risks

- Low — additive UI feature, existing slash-command behavior on Enter without using
  autocomplete must be unaffected.

## Open Questions

## Notes
