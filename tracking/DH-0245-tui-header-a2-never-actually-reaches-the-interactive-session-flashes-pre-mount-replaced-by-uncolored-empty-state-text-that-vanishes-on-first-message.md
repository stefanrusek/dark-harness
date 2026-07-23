---
spile: ticket
id: DH-0245
type: bug
status: verifying
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

### 2026-07-20 — Mary, implemented and verified

Structural shape chosen: **synthetic leading rows in `TranscriptPane`'s own `lines` array**
(the ticket's own suggested default), not a separate persistent `<Box>` — `TranscriptPane`
already worked in a flat `string[]` "already-wrapped visual rows" domain (`renderTranscript`
returns raw ANSI-styled lines, `emptyText` was already a `\n`-joined string prepended the
same way), so a new optional `headerLines?: string[]` prop that's unconditionally prepended
(`[...headerLines, "", ...bodyLines]`, `bodyLines` being either `emptyText` or the real
turns) got the same scroll/windowing participation (`scroll-viewport.ts`) for free — no
change to `scroll-viewport.ts` itself was needed, confirming the ticket's own Assumption.
`RootView` builds `headerLines` by calling `renderHeaderA2(header.facts, header.level, {
columns: state.size.cols, rows: state.size.rows })` directly — the *exact* function
`run.ts`'s pre-mount print already calls, so the plain-fallback path (User Story 4) falls out
for free with zero new fallback string. `header.facts`/`header.level` are the same
`HeaderStatusFacts`/`ColorLevel` `run.ts` already resolves for its own pre-mount print,
threaded through unchanged via a new optional `header` field on `StartTuiOptions` ->
`mountInk`'s new 5th param (captured in a closure, since it's static for the session, unlike
`state` which changes every render) -> `App`'s new `header` prop -> `RootView` only (not
`AgentView` — its own per-agent pane has no such banner, out of the ticket's scope).
`buildRootEmptyText` (`RootView.tsx`) shrank to just the "Type a message below to get
started." hint — the app-identity banner itself moved to `headerLines`, so keeping the old
`formatEmptyStateLines`-sourced logo there too would have double-printed it.

User Story -> proving test:
- **Story 1** (real Header A2 content, in real color, before any message): `RootView.test.tsx`
  `"User Story 1: with a header prop and a large/truecolor terminal, shows Header A2's real
  gradient wordmark content, in real color"` — asserts a real truecolor SGR escape
  (`\x1b[38;2;`) and the `facts.configLine` status-tree content are both present pre-first-
  message.
- **Story 2** (persists once the first message is sent): `TranscriptPane.test.tsx` `"DH-0245
  User Story 2: headerLines persist once the first turn is sent — still present in the render
  tree immediately after"` — asserts `headerLines` content survives a `rerender` with a
  non-empty transcript.
- **Story 3** (scrolling to the top reveals it again): `TranscriptPane.test.tsx` `"DH-0245
  User Story 3: scrolling to the very top reveals headerLines again"` — with 20 turns
  overflowing a 3-row viewport, asserts the banner is scrolled out of view at the bottom and
  reappears after a large negative `scrollBus` delta clamps the offset to 0.
- **Story 4** (small-terminal/no-color plain fallback matches `renderHeaderA2`'s own
  fallback): `RootView.test.tsx` `"User Story 4: on a terminal below the size gate, uses the
  exact same plain-fallback content renderHeaderA2 itself falls back to"` — compares the
  rendered frame against `renderHeaderA2`'s own direct output for the same facts/terminal size
  (line-for-line `toContain`, single source of truth by construction, not by convention) plus
  a companion `"level: 'none'"` test for the color-unavailable (not just size-gate) trigger.

End-to-end wiring also covered: `App.test.tsx` (`header` prop reaches `<RootView>`),
`app.test.ts` (`opts.header` reaches the real mounted Ink tree via `startTui` against a fake
stdout, asserting `facts.configLine` lands in the captured writes).

Real-PTY verification (per the ticket's own Risk note — `lastFrame()` alone wasn't trusted):
built the real compiled binary (`bun run build` -> `dist/dh`), ran it under a real `tmux`
session (100x35, `COLORTERM=truecolor`) against the repo's real `dh.json` + `secrets.env`
(no mock). Confirmed, reading the raw captured pane (`tmux capture-pane -e`) with real SGR
truecolor escapes intact:
1. On first launch, the gradient wordmark + status tree render inside the mounted Ink
   session (not just the pre-mount flash) with real per-character `\x1b[38;2;R;G;Bm`
   truecolor codes, before any message was sent.
2. After sending a real chat message ("hello there") and getting a real model reply, the
   banner's tail (config/bind/logs lines) remained visible above the conversation — it did
   not vanish.
3. Simulating 15 SGR mouse wheel-up events (`\x1b[<64;10;10M`, matching the real wire format
   `mouse.ts` parses) scrolled the transcript to the top and revealed the full wordmark again,
   above the "0 tok" status line at frame top — confirming the scroll-to-top behavior in a
   real terminal, not just the pure `scroll-viewport.ts` unit tests.

Gates: `bun run typecheck` clean; `bun run lint` clean; `bun run test:coverage`
(`bun scripts/test-isolated.ts --coverage`) 100.0% line coverage (15668/15668), 145/146 test
files passed — the one failure (`src/web/client/app.test.ts`, a DH-0135 composer-focus test,
Susan's domain) reproduces only under full-suite parallel load and passes standalone
(`bun test src/web/client/app.test.ts`: 43/43); this exact flake was already documented as
pre-existing by a prior round (`docs/roster/mary.md`'s DH-0230 entry), confirmed unrelated —
this ticket touched no `src/web/` file.

Files touched: `src/tui/ink/TranscriptPane.tsx` (`headerLines` prop),
`src/tui/ink/RootView.tsx` (`header` prop, `renderHeaderA2` call, shrunk
`buildRootEmptyText`), `src/tui/ink/App.tsx` (`header` prop threaded to `<RootView>`),
`src/tui/ink/mount.ts` (`header` param, closed over across rerenders), `src/tui/app.ts`
(`StartTuiOptions.header`), `src/cli/deps.ts` (`CliDeps.startTui`'s `opts` type),
`src/cli/run.ts` (both `deps.startTui` call sites now pass `{ header: { facts: a2Facts,
level } }` — the same `a2Facts`/`level` already built for the pre-mount print, no new facts
computation). No `src/contracts/` change, no ADR/invariant touched.
