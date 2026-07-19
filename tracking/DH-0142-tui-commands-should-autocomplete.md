---
spile: ticket
id: DH-0142
type: feature
status: closed
owner: stefan
resolution: done
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

### 2026-07-19 — implemented

Shared matcher landed in `src/client-core/command-list.ts` (`CommandEntry`, `BUILTIN_COMMANDS`,
`buildCommandList`, `filterCommands`, `commandQueryFromInput`, `autocompleteMatches`) — reused
as-is by DH-0143 (Web) and merges in skills per DH-0144. Tests:
`src/client-core/command-list.test.ts`.

TUI wiring: `TuiState.dropdownIndex`/`dropdownDismissed` (`src/tui/types.type.ts`),
`visibleAutocomplete` helper + reducer interception of Down/Up/Enter/Tab/Escape in
`handleRootKey` (`src/tui/state.ts`), rendering in `src/tui/ink/Composer.tsx`. Selecting an
entry inserts `/<name> ` (trailing space) so the dropdown closes itself via
`commandQueryFromInput`'s "whitespace after the name" rule — no separate "just selected" flag
needed. Enter on an *already*-fully-typed command name (e.g. `/model`) falls through to the
pre-existing DH-0093 "execute now" behavior rather than being swallowed by the dropdown, since
its single exact match is incidental, not a real completion — preserves all pre-existing
`/model`, `/help`, `/clear`, `/<skill>` reducer tests unchanged.

User Story tests: `src/tui/state.test.ts`'s `describe("DH-0142: slash-command autocomplete")`
block (Down/Up cycling+wrap, Enter/Tab select+insert, selecting after navigating, Escape
dismissal, no-match/dismissed closing, reset-on-keystroke) plus rendering assertions in
`src/tui/ink/Composer.test.tsx`.

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100.00% lines) all green.
`bun run e2e`: one pre-existing flake (`e2e/web.test.ts`/`e2e/connect-web.test.ts`, a
process-spawn `stream.getReader()` race in `e2e/support/dh-process.ts`, unrelated to this
change) reproduces identically on a clean, unmodified worktree at the same commit — not a
regression from this work. `e2e/slash-commands.test.ts` and `e2e/tui.test.ts` (the tests that
actually exercise the composer) pass reliably.
