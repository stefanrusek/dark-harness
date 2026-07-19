---
spile: ticket
id: DH-0142
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0143]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0142: TUI: / commands should autocomplete

## Summary

Owner request 2026-07-17: typing / in the TUI composer should offer autocomplete for recognized slash commands, same general pattern as command palettes elsewhere. TUI domain (Mary). Sibling ticket for the Web UI filed separately (dispatch system splits cleanly by UI ownership) -- check for shareable logic (e.g. the underlying command list/matcher) once both are scoped, but the actual autocomplete UI/interaction is necessarily per-surface.

**Owner decision (2026-07-19):** dropdown list, filters as you type (arrow keys + Enter/Tab
to select), showing each command's name plus a short description (e.g. "/model — switch the
active model"), not names alone.

**Design note:** `src/client-core/` (established by DH-0183) now exists as the shared
client-implementation directory both TUI and Web already import from for slash-command
*parsing*. The command list + description strings and the filter-matching logic belong there
too — only the dropdown rendering/keyboard-interaction layer is genuinely TUI-specific
(Ink component). Check DH-0143 lands its own matcher against the same shared piece rather
than duplicating; coordinate landing order or merge conflict risk is low since the shared
matcher is small.

## User Stories

### As a TUI user, I want a filtered command list when I type `/`, so I can discover and select commands without memorizing them

- Given the composer is empty and the user types `/`, when the input matches zero or more
  recognized commands, then a dropdown appears listing each matching command's name and a
  short description, updating live as more characters are typed.

### As a TUI user, I want to navigate and select from the dropdown with the keyboard

- Given the dropdown is showing, when the user presses Down/Up, then the highlighted entry
  moves accordingly; when they press Enter or Tab, then the highlighted command's name is
  inserted into the composer and the dropdown closes.

### As a TUI user, I want the dropdown to close cleanly when it's no longer relevant

- Given the dropdown is open, when the user types a character that matches no command, or
  presses Escape, or the input no longer starts with `/`, then the dropdown closes.

## Functional Requirements

- Command list + descriptions + filter-matching: shared logic in `src/client-core/`, reused
  by DH-0143 (Web).
- Dropdown rendering + keyboard interaction: TUI-specific (Ink), lives in `src/tui/`.
- No matches: dropdown simply doesn't render (not an error state).

## Assumptions

- The command list to autocomplete against is the same set `src/client-core/`'s
  slash-command parser already recognizes (DH-0183) — no new commands invented here.

## Risks

- Low — additive UI feature, existing slash-command behavior on Enter without using
  autocomplete must be unaffected.

## Open Questions

## Notes
