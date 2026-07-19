---
spile: ticket
id: DH-0143
type: feature
status: closed
owner: stefan
resolution: done
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

### 2026-07-19 — implemented

Reuses DH-0142's shared matcher (`src/client-core/command-list.ts`) as-is — no Web-specific
fork.

Web wiring: `src/web/client/components/Composer.tsx` gained local `useState` for the
textarea's current value (kept separate from the uncontrolled `value`/focus behavior that
DH-0117's regression test protects — never wired to the textarea's `value` prop), the
highlighted index, and a dismissed flag. Dropdown renders as a `<ul class="composer-
autocomplete">` under the form; ArrowDown/ArrowUp/Enter/Tab/Escape are intercepted in
`onKeyDown` ahead of the existing Enter-submits handling; a `mousedown` document listener
(inside a `useEffect`, cleaned up on unmount/dropdown-close) closes it on click-outside, per
this ticket's third User Story. Same "already-fully-typed command falls through to submit,
not re-selection" guard as DH-0142's TUI fix, so pressing Enter on a complete `/model` still
sends the message rather than being swallowed by the dropdown.

User Story tests: `src/web/client/components/Composer.test.tsx` — dropdown-while-typing,
bare-slash-shows-all, no-dropdown-for-chat-text, no-match-closes, Arrow nav, Enter/Tab
select+insert (including the already-complete-submits case), mouse-click select,
Escape-dismiss-keeps-text, click-outside-closes, re-open-after-Escape-on-new-keystroke,
skills merged into the list (DH-0144 tie-in).

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100.00% lines) all green.
`bun run e2e`: one pre-existing flake (`e2e/web.test.ts`/`e2e/connect-web.test.ts`'s
`stream.getReader()` process-spawn race in `e2e/support/dh-process.ts`) reproduces
identically on a clean, unmodified worktree — not a regression here. `e2e/web.test.ts` and
`e2e/slash-commands.test.ts` pass reliably when run directly.
