---
spile: ticket
id: DH-0136
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["blocked on DH-0133a (Core toolchain) landing first"]
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0136: UI overhaul phase 2: migrate TUI to Ink

## Summary

Per Fable's DH-0133 design (2026-07-17): migrate src/tui/render.ts's ANSI string-array building and app.ts's manual frame loop to Ink components, view by view (root/composer first, then agent tree, then transcript pane). state.ts/types.ts reused as-is (modulo whatever DH-0126's remaining scrolling-UI work independently requires). Ink's useInput/usePaste supersede app.ts's manual stdin listener; keys.ts parsing logic likely adaptable rather than discarded. Note (Fable, explicit): Ink does NOT structurally fix DH-0126's mouse-scroll-into-input bug (Ink has no built-in mouse/scroll support) -- that's separate protocol-level work, already split out and dispatched independently. This ticket covers only render-layer migration plus the deferred scrollable-transcript-UI remainder of DH-0126, and DH-0122/DH-0124/DH-0125's TUI-side work (app header, empty-state message, status row) and DH-0130's TUI-side render addition. TUI domain (Mary).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
