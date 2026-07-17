---
spile: ticket
id: DH-0137
type: feature
status: verifying
owner: grace
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133, DH-0134, DH-0135, DH-0136]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0137: Shared design-token module for status/connection color+glyph, consumed by both React and Ink component trees

## Summary

Muriel design pass 2026-07-17 on DH-0133: STATUS_COLOR (src/tui/render.ts) and STATUS_STYLES (src/web/client/format.ts) independently re-derive the same canonical status/connection color+glyph+word table documented in docs/design/style-guide.md SS1/1.2/2.3, duplicated by hand rather than imported from one source (unlike numeric formatting, which src/format.ts already centralizes per DH-0104). The render-layer rewrite (DH-0133b/c) is the moment to fix this: extract a single small module of the design-system constants (status/connection state to color+glyph+word, per-surface representation: hex for Web CSS custom properties, SGR code for TUI) that both new React and Ink component trees import, instead of each re-deriving it again in JSX/Ink form. Core (Grace) owns it as a root-level src/ shared module (same precedent as src/format.ts); DH-0135 and DH-0136 each depend on it landing (or land in lockstep) since their status-rendering components are the first consumers. Out of scope: this is prose/constants only, not a src/contracts/ wire change, no architect sign-off needed.

## User Stories

### As Susan (Web) or Mary (TUI), I want one canonical source for status/connection color+glyph+word, so my React/Ink components can't silently drift from style-guide.md or from each other

- Given the five `AgentStatus` values and the four connection states (style-guide.md SS1/1.2), when a component needs that status's color, glyph, and word, then it imports a typed lookup from the new shared module rather than declaring its own `Record<AgentStatus, ...>` literal, proven by a unit test asserting the module exports a complete mapping for all five `AgentStatus` values and all four connection states, with no surface-local file declaring a competing `STATUS_COLOR`/`STATUS_STYLES`-shaped record afterward (grep-based regression test: no `Record<AgentStatus,` outside the shared module and its test file).
- Given the module must serve two different renderers, when a status's color is looked up, then the module returns both representations from one shared "intent" per status (Web: CSS custom-property name/hex per style-guide.md SS2.1; TUI: SGR code per SS2.2) so a color assignment can never update on one surface and not the other, proven by a table-driven test asserting every status's Web hex and TUI SGR code match the style-guide.md SS2.3 hue map exactly (e.g. `running` -> `#4f8cff` / `34`).
- Given style-guide.md SS1 already states glyph/word/color per status is "law; deviations are tickets," when this module is built, then it is generated from (or kept mechanically in sync with, via a test that fails on drift) the tables in style-guide.md SS1/1.2/2.3 rather than being a fresh, independent transcription, proven by a test that parses or hardcodes the same values as the doc's tables and fails if either drifts without the other being updated.
- Given DH-0135/DH-0136 will each write status-rendering components (agent tree dot, connection pill), when those components need a color, then they import from this module — this ticket's Functional Requirements below are written so DH-0135/DH-0136 can cite "per DH-0137" instead of re-specifying the table.

## Functional Requirements

- New module (recommend `src/design-tokens.ts`, sibling to `src/format.ts`, same "shared, framework-independent, imported by both `src/web/client/` and `src/tui/`" precedent) exporting:
  - `STATUS_TOKENS: Record<AgentStatus, { word: string; glyph: string; webVar: string; webHex: string; sgr: string }>` for the five statuses in style-guide.md SS1.
  - `CONNECTION_TOKENS: Record<ConnectionState, { webLabel: string; tuiLabel: string; sgr: string; pending: boolean }>` for the four connection states in style-guide.md SS1.2 (`connecting`/`live`/`reconnecting`/`disconnected`), capturing the pending-vs-resolved distinction (SS1.1) so a consuming component doesn't need to re-derive "is this a pending state" from the label.
  - Casing (Title Case for Web, lowercase for TUI/CLI, per style-guide.md SS4) is a presentation-layer decision left to each consuming component — the module exports one canonical lowercase word per status/state and callers apply `.toUpperCase()`/title-casing themselves, so the module doesn't need two near-duplicate word fields.
- `src/tui/render.ts`'s `STATUS_COLOR` and `src/web/client/format.ts`'s `STATUS_STYLES` are deleted and replaced with imports from this module as part of DH-0135/DH-0136's own migration work (not this ticket doing the swap in the old renderers — this ticket only needs to *exist and be correct* before DH-0135/DH-0136 consume it; retrofitting the pre-migration `render.ts` files is unnecessary churn on code about to be deleted anyway).
- 100% unit coverage per CLAUDE.md SS5 — this is a small, pure, high-fanout module; every entry needs a test, not just a sampling.

## Assumptions

- This lands before or in lockstep with DH-0135/DH-0136's first status-rendering component (agent tree dot / connection pill) — sequencing is a coordinator call, not prescribed here, but the dependency is real: those components' Given/When/Then in DH-0135 SS DH-0136 cite this module directly.
- No `src/contracts/` change: `AgentStatus` and connection-state values themselves are unchanged; this module only centralizes their *presentation*, which is design-crew territory, not wire truth.

## Risks

- Low risk, small surface. The main failure mode is scope creep into "let's also centralize spacing/typography tokens" — explicitly out of scope for this ticket; `--space-*`/`--radius-*`/font tokens stay Web-CSS-only per style-guide.md SS2.1 since Ink has no analogous concept (terminal cells aren't a spacing system) and inventing a fake shared unit for them would be speculative, not a real cross-surface need.

## Open Questions

- None blocking. Exact module name/path is Grace's call within the `src/` root-level-shared-module convention `src/format.ts` already established.

## Notes

Filed by Muriel (design crew) per CLAUDE.md SS7, as part of the DH-0133 UI-overhaul design pass (owner ask 2026-07-17, following Fable's architecture-level design on DH-0133). This formalizes what style-guide.md SS1/1.2/2.3 already state as canonical prose into an importable module, closing the gap where two renderers currently transcribe the same table by hand.

### 2026-07-17 — implemented, ready for verification

- Added `src/design-tokens.ts` exporting `STATUS_TOKENS`
  (`Record<AgentStatus, {word,glyph,webVar,webHex,sgr}>`) and `CONNECTION_TOKENS`
  (`Record<ConnectionState, {webLabel,tuiLabel,sgr,pending}>`), transcribed from
  `docs/design/style-guide.md` §1/§1.2/§2.3.
- `src/tui/render.ts`'s `STATUS_COLOR` and `src/web/client/format.ts`'s `STATUS_STYLES` are
  intentionally left in place per this ticket's own scope note (DH-0135/DH-0136 own removing
  them during their migration) — not touched.
- 100% unit test coverage (`src/design-tokens.test.ts`): table-driven tests asserting every
  status/state's fields against `style-guide.md`'s tables verbatim, plus a grep-based
  regression test walking `src/` for any competing `Record<AgentStatus,` declaration outside
  the shared module (allowlisting the two known pre-migration duplicates plus
  `src/cli.ts`'s own `CLI_STATUS_COLOR`, which is out of scope for DH-0135/DH-0136's
  React/Ink migration).
- User Stories → tests: story 1 (complete mapping, no competing record) →
  `design-tokens.test.ts` "has a complete entry..." + "no file outside the shared module
  declares Record<AgentStatus,...>"; story 2 (Web hex + TUI SGR match style-guide.md §2.3) →
  the per-status table-driven tests; story 3 (kept in sync with style-guide.md, drift fails
  the test) → the same table-driven tests, hardcoded from the doc's tables.
