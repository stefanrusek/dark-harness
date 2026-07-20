---
spile: ticket
id: DH-0245
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0220, DH-0221, DH-0224]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0245: TUI: Header A2 never actually reaches the interactive session -- flashes pre-mount, replaced by uncolored empty-state text that vanishes on first message

## Summary

Owner live-testing finding (2026-07-20): DH-0220's Header A2 (big gradient wordmark + wiring tree, real truecolor) is printed to raw stdout in run.ts BEFORE Ink mounts, then wiped within a fraction of a second by Ink's alt-screen clear (ESC[2J). It is never actually visible inside the interactive TUI session. What the operator sees instead and mistakes for 'the header' is RootView.buildRootEmptyText's pre-first-message empty text (plain DARK HARNESS + ASCII tree fallback content from formatEmptyStateLines, never routed through paint()/BRAND/detectColorLevel -- hence no color at all, confirmed separately from markdown color spans which do work). That empty text is a TranscriptPane prop shown only when zero turns exist -- the instant the first message lands, TranscriptPane switches to the real turn list and the empty text is gone permanently: it is not part of scrollback, does not persist, does not scroll back into view. Fix direction: Header A2 (or an Ink-native equivalent using the same BRAND/paint/detectColorLevel primitives already established by DH-0220/0221) needs to become a genuine persistent element of the interactive session -- most naturally a synthetic leading entry in TranscriptPane's own turn history, so it survives the first message, scrolls with real content, and scrolling back to the top reveals it again, in real color.

## User Stories

### As an operator starting `dh` interactively, I want the real Header A2 banner, in real color, not a plain uncolored placeholder

- Given a TTY with ≥80 cols/≥30 rows and truecolor/ansi256 support, when the interactive TUI's
  root view first renders (before any message is sent), then it shows Header A2's actual
  gradient wordmark + wiring tree — sourced from the same `renderHeaderA2`/`BRAND`/`paint`
  pipeline `run.ts` already uses for the pre-mount stdout print, not `formatEmptyStateLines`'s
  plain ASCII fallback content.
- Given `detectColorLevel` resolves to `"truecolor"` or `"ansi256"` for this session, when the
  in-session header renders, then it is actually colored (not `dim()`/plain-text-only) —
  closing the gap where the operator currently sees no color at all in the header despite
  their terminal supporting it and markdown colored-spans working correctly elsewhere in the
  same session.

### As an operator, I want the header to persist once I send my first message, not vanish

- Given the interactive TUI with zero turns sent, when the operator sends their first message,
  then the header remains visible as the top of the transcript (not replaced/discarded) —
  proven by an ink-testing-library test asserting the header's content is still present in the
  render tree immediately after the first turn is added.

### As an operator, I want to scroll back up and see the header again

- Given a transcript with enough turns to fill the visible pane, when the operator scrolls up
  to the very top, then the header is the first thing revealed — proven by a
  `scroll-viewport`/`TranscriptPane` test that scrolls to offset 0 and asserts the header
  content is present in `lastFrame()`.

### As an operator on a small/non-TTY terminal, I want the same plain-fallback behavior as the CLI's own Header A2

- Given the size gate fails (<80 cols/<30 rows) or color is unavailable (`NO_COLOR`/`--plain`/
  non-TTY), when the in-session header renders, then it uses the exact same plain-text
  fallback content Header A2 itself falls back to (not a third, independently-maintained
  fallback string) — single source of truth for both the pre-mount print and the in-session
  render.

## Functional Requirements

- Make the interactive TUI's in-session header a genuine persistent element, not a
  `TranscriptPane` `emptyText` prop that disappears once turns exist. Most natural shape: a
  synthetic leading entry prepended to `TranscriptPane`'s own turn/row list (so it participates
  in the same windowing/scroll-offset math as everything else, per `src/tui/scroll-viewport.ts`)
  — an alternative is a separate always-rendered `<Box>` above `TranscriptPane` that isn't
  gated on turn count, but the "scrolls with content, revealed by scrolling to the top" ask in
  the User Stories favors it being real transcript content, not fixed chrome. Implementer's
  call on final shape, but the four User Stories above are the acceptance bar either way.
  Correction from the ticket's own initial Summary: it did not turn out to need
  `Object.freeze`/render-order changes to `run.ts`'s pre-mount stdout print at all — that print
  is fine as-is (it's what a non-interactive/piped consumer or the split-second before Ink
  takes over sees); this ticket is scoped to what renders *inside* the mounted Ink session.
- Reuse the existing `renderHeaderA2`/`BRAND`/`paint`/`lerpHex`/`detectColorLevel` primitives
  (`src/cli/header.ts`, `src/design-tokens.ts`, `src/cli/color-context.ts`) — do not
  reimplement gradient/color logic a second time for the in-Ink render. If `renderHeaderA2`'s
  current signature/output shape (plain ANSI-string lines) isn't directly Ink-component-shaped,
  adapt it (e.g. a thin wrapper rendering each returned line via `<Text>`) rather than
  rewriting the underlying color/layout math.
- `detectColorLevel`'s inputs (`isTTY`, `env`, `plain`) must be threaded into the in-session
  header the same way they already reach `run.ts`'s pre-mount print — confirm the TUI's own
  entry path (`src/tui/app.ts`/`src/cli/run.ts`'s TUI branch) actually has access to a real,
  current `ColorLevel` at the point the Ink tree is composed, rather than defaulting to
  `"none"` or falling back to `dim()`-only styling as it does today.
- The plain-fallback (small terminal / no color) content must be the *same* fallback
  `renderHeaderA2` itself uses when its own size/color gate fails — not a second, independently
  drifting fallback string (`formatEmptyStateLines`'s current content is exactly this kind of
  drift risk; either reuse it as the acknowledged plain-fallback source, or fold it into
  `renderHeaderA2`'s own fallback path so there's one definition).

## Assumptions

- The pre-mount stdout print in `run.ts` (before Ink's alt-screen switch) stays as-is — it's
  legitimate for the split-second before mount and for any non-interactive consumer reading
  stdout before the alt-screen sequence. This ticket only fixes what's visible *inside* the
  mounted Ink session.
- `TranscriptPane`'s existing scroll/windowing math (`scroll-viewport.ts`) can accommodate a
  synthetic non-turn leading entry without a structural rewrite — confirm during implementation;
  if it genuinely can't, the separate-persistent-`<Box>`-above-`TranscriptPane` alternative
  noted in Functional Requirements is the fallback shape.

## Risks

- Frame-height math: `App.tsx`'s `HEADER_ROWS`/`contentRows` calculation assumes fixed row
  counts for `TitleBar`/`Header`/`StatusRow` — if the in-session Header A2 becomes part of
  `TranscriptPane`'s scrollable content instead of a fixed reserved row, that's actually
  simpler (no frame-height recalculation needed, since it's just more scrollable rows), but
  double-check no existing frame-height test assumed the header would never appear as
  transcript content.
- Real color rendering inside Ink needs to be verified against a real PTY (similar to how
  DH-0220's CLI-only header was verified), not just `ink-testing-library`'s `lastFrame()` string
  output, to confirm the actual escape sequences an operator's terminal receives are correct —
  `lastFrame()` does capture ANSI codes as text, so this may be sufficient, but cross-check with
  a real compiled-binary PTY run before closing.

## Open Questions

None blocking — the four User Stories are the acceptance bar; final structural shape (synthetic
transcript entry vs. persistent fixed `<Box>`) is an implementer call within those constraints.

## Notes

Filed by the coordinator directly from a live owner bug report (2026-07-20), diagnosed by
reading `src/cli/run.ts` (pre-mount `renderHeaderA2` print + Ink alt-screen clear),
`src/tui/ink/TitleBar.tsx` (the always-visible but uncolored, unrelated title line the owner
was likely also seeing), `src/tui/ink/Header.tsx` (the DH-0122 reserved slot, also unrelated —
one dim version line, not Header A2), and `src/tui/ink/RootView.tsx` (`buildRootEmptyText`,
sourcing `formatEmptyStateLines`'s plain fallback content as `TranscriptPane`'s `emptyText`
prop — confirmed this is what actually vanishes on the first message, and confirmed via grep
that none of `TitleBar`/`Header`/`RootView`'s empty-state path route through `paint()`/`BRAND`,
explaining the reported total absence of color in the header despite the terminal supporting
it and markdown colored-spans working correctly elsewhere in the same session.
