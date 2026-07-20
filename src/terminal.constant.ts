// Shared terminal presentation constants (docs/design/style-guide.md §1.1/§3): the canonical
// braille spinner frame set + frame interval, used by every surface that shows a "live/
// pending" state on a TTY. Extracted from `src/tui/render.ts` (DH-0102) so `src/cli.ts`
// (doctor's live per-model rows) and `src/tui/` share one spinner rather than forking the
// frame array — the design guide's "one concept, one look, everywhere" principle applied to
// code, not just prose. TUI still owns the presentation domain; this module is purely-
// additive shared state, not a reach into TUI's internals — `src/tui/render.ts` re-exports
// these names unchanged so its own imports/behavior are untouched.
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_FRAME_MS = 120;
