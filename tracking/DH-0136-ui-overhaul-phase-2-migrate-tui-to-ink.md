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

### As Mary, I want the root view/composer migrated first, so in-progress typed text survives background liveness ticks the same way DH-0133's Web equivalent does

- Given the composer has in-progress typed text, when a background tick (spinner/elapsed-time liveness) fires, then the typed text is preserved, proven by an ink-testing-library test analogous to the Web regression guard in DH-0135 (restated from DH-0133).
- Given the root/composer view is the first migrated to Ink, when the agent tree and transcript pane are still on the old `render.ts` ANSI code, then `app.ts`'s frame loop and the new Ink root correctly share the terminal (no double-writes, no cursor-position corruption), proven by an integration test asserting a single coherent frame is produced during the mixed old/new period.

### As Mary, I want a `<Header>` slot reserved in the Ink component tree now, so DH-0122's app header and DH-0124's empty-state variant slot in without restructuring the tree later

- Given the new Ink component tree (root `App` composing header/tree/transcript/composer/status-row), when it is first assembled, then it includes a `<Header agentState={...} dhConfig={...} variant="full" | "empty" />` slot positioned above the agent tree/transcript per style-guide.md SS5's panel convention, proven by an ink-testing-library test asserting `<Header>` exists in the render tree.
- Given DH-0122/DH-0124 have not landed yet, when `<Header>` renders with no content implemented, then it renders zero rows (no blank reserved lines eating vertical space in an already height-constrained terminal view) rather than a placeholder, proven by a `lastFrame()` test asserting frame height is unchanged with `<Header>` present vs. absent.
- Given DH-0124 will need a lighter "empty-state" header variant (fewer dh.json fields, friendlier first-message prompt) distinct from DH-0122's full startup header, when `<Header>` is designed, then its props accept a `variant` distinguishing the two so DH-0124 doesn't need a second, parallel header component, proven by the component's prop type accepting both variants even though only `"empty"`'s content is TODO until DH-0124 lands (both are TODO until DH-0122/DH-0124 respectively; the point proven here is the single-component contract, not populated content).

### As Mary, I want a `<StatusRow>` slot reserved directly under the composer now, so DH-0125's model/progress/git-branch row lands as content-only work later

- Given the new Ink component tree, when the composer is composed, then a `<StatusRow agentState={...} gitInfo={...} />` slot exists immediately below it (matching DH-0125's explicit ask: "a row under the input box"), proven by a test asserting `<StatusRow>` occupies the row immediately after the composer in `lastFrame()` output.
- Given DH-0125 has not landed yet, when `<StatusRow>` renders with no fields implemented, then it renders zero rows (same reserved-but-inert convention as `<Header>`), proven analogously to the `<Header>` empty-frame test.
- Given DH-0125's own ticket still needs to settle exact fields/compactness/narrow-terminal behavior (explicitly its own open design question, not resolved here), when `<StatusRow>`'s slot is reserved, then this ticket commits only to the slot's position and its "renders nothing until populated" contract, not to field content — DH-0125 remains the ticket that specifies and implements what fills it.

### As Mary, I want the agent tree's status dot and connection indicator to import color/glyph/word from DH-0137's shared design-token module, so the TUI's status rendering can't independently drift from Web's

- Given DH-0137 (shared design-token module) has landed, when the agent tree's status dot or the connection indicator renders, then it looks up SGR code/glyph/word via `STATUS_TOKENS`/`CONNECTION_TOKENS` rather than the old `STATUS_COLOR` local map, proven by a test asserting no `Record<AgentStatus,`-shaped literal exists in the new TUI component files, mirroring DH-0135's equivalent story.
- Given `src/tui/markdown-ansi.ts`'s DH-0056 SGR allowlist, when `<StatusDot>`/tree-row components apply color, then they only ever emit SGR codes present in DH-0137's module (which is itself constrained to the allowlist), proven by the existing SGR-allowlist regression test continuing to pass against the new component output.

### As Mary, I want the deferred scrollable-transcript-UI remainder of DH-0126 built as part of this migration, using privateer's `scroll-viewport.ts` shape as prior art, so scroll offset/windowing isn't redesigned from scratch

- Given a transcript longer than the visible pane height, when the operator scrolls (once DH-0126's urgent input-parsing half is separately fixed and mouse events reach the TUI cleanly), then the transcript pane windows to the scroll offset using a pure `ScrollState`/`clampOffset`/`visibleSlice` module analogous to privateer's `src/ui/scroll-viewport.ts` (per DH-0133's Notes), rendered via `<Box height={N} overflow="hidden">` around the pre-sliced rows, proven by a unit test on the pure offset/windowing module (a 100%-coverage target independent of Ink rendering) plus an ink-testing-library test asserting `lastFrame()` shows only the windowed slice at a given offset.
- Given the transcript is at the bottom when new content arrives (mirroring DH-0135's DH-0129 story for Web), when new content arrives, then the view auto-scrolls to reveal it; given the transcript is scrolled up, when new content arrives, then it does not force-scroll, proven by a test analogous to DH-0135's DH-0129 story, applied to the TUI's `ScrollState`.

### As Mary, I want DH-0130's TUI-side render addition for the per-agent terminal-status marker included in the transcript pane component

- Given `state.ts`'s reducer-side terminal-status marker derivation (unblocked, framework-agnostic per DH-0133), when the transcript pane renders, then it displays the marker using DH-0137's status tokens for the terminal status's glyph/color/word, proven by an ink-testing-library test asserting the marker's `lastFrame()` output matches the expected glyph/color/word for each terminal status.

### As the coordinator, I want confirmation this ticket's components read `TuiState` without behavioral changes to the reducer beyond DH-0126's own scope

- Given the existing `state.ts`/`types.ts` reducer and its test suite, when this ticket's components are built, then the reducer requires no behavioral changes beyond what DH-0126's scrolling-remainder work (folded into this ticket per the story above) independently requires, proven by `bun test src/tui/state.test.ts` passing with at most the DH-0126-attributable diff (restated from DH-0133, now scoped explicitly to the scroll-viewport addition).

## Functional Requirements

- Introduce `ink` + `react` per DH-0134's toolchain integration, targeting the version pins DH-0133 recommends matching against privateer (Ink 5.x + React 18.x, `ink-testing-library` 4.x) unless DH-0134's own spike finds a concrete reason to diverge.
- Migration order (per DH-0133, restated as plan of record): root view/composer -> agent tree -> transcript pane (folding in the DH-0126 scroll-viewport remainder and DH-0130's marker). `<Header>` and `<StatusRow>` slots are reserved from the first PR that assembles the root `App` composition (same rationale as DH-0135's `<AppHeader>` — cheap to reserve early, both DH-0122/DH-0124 and DH-0125 are queued to land immediately after).
- `state.ts`, `sse-client.ts`, `http-client.ts`, `keys.ts` (parsing, not raw-mode wiring), `markdown-ansi.ts` (content logic), `width.ts` reused as-is — restated from DH-0133.
- Ink's `useInput`/`usePaste` supersede `app.ts`'s manual stdin listener; `keys.ts`'s parsing logic is adapted, not discarded, per DH-0133's assessment.
- Mouse-scroll input handling (DH-0126's urgent half: SGR mouse parsing, dual-stdin-listener wiring, leaked-mouse-input guard on `useInput`, exit-safe lifecycle) is DH-0126's own ticket scope, already split out and dispatched independently per DH-0133 — this ticket's scroll-viewport windowing consumes whatever offset DH-0126's fix produces but does not implement the mouse-event parsing itself.
- Status/connection color+glyph+word rendering imports from DH-0137's shared module; no component re-declares `STATUS_COLOR` locally.
- `<Header>` and `<StatusRow>` both follow the "reserved slot renders zero rows until its content ticket lands" convention — this is a deliberate, testable contract (see User Stories), not an implicit assumption.

## Assumptions

- DH-0134 (Core toolchain) has landed and verified `bun build --compile` bundles Ink cleanly and ink-testing-library works under `bun test` before this ticket's first PR.
- DH-0137 (shared design-token module) lands before or alongside the agent-tree-section PR (the first PR needing status colors).
- DH-0126's urgent input-parsing fix (mouse SGR parsing / leaked-input guard) is dispatched and landed independently, per DH-0133's recommendation, before or in parallel with this ticket's transcript-pane scroll-viewport work — the two are complementary (input parsing vs. windowing/rendering) and both are needed for scrolling to actually work end to end, but neither blocks starting the other.

## Risks

- Restated from DH-0133: `render.test.ts` (689 lines) / `app.test.ts` (790 lines) rewrite cost is the dominant effort driver.
- Ink has no built-in scrolling primitive (confirmed in DH-0133's research) — the scroll-viewport module is new code, not a port of an Ink feature; privateer's `scroll-viewport.ts` is prior art for the *shape*, not a drop-in dependency (it lives in a different repo/binary).
- `<Header>`/`<StatusRow>` rendering zero rows when empty needs explicit frame-height tests (same risk class as DH-0135's `<AppHeader>` — an easy place for a stray blank line to sneak into an already space-constrained terminal view).

## Open Questions

- None blocking. `<Header>`'s exact `variant` prop shape beyond "full vs. empty" is DH-0122/DH-0124's own design work; `<StatusRow>`'s field content is DH-0125's own design work. This ticket commits only to slot position and the inert-until-populated contract.

## Notes

Updated by Muriel (design crew) 2026-07-17 per the owner's request for a felt-experience design pass on DH-0133 before implementation starts. See `docs/design/style-guide.md` SS1/1.2/2.3 (status/connection tokens), SS3 (glyph vocabulary — tree connectors, spinner), and SS5/SS6 (panel/liveness conventions informing `<Header>`/`<StatusRow>` placement). Companion ticket: DH-0137 (shared design-token module), DH-0135 (this ticket's Web counterpart). Does not touch DH-0126 itself (separate ticket, separate owner call per DH-0133) beyond consuming its output.
