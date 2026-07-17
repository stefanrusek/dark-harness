---
spile: ticket
id: DH-0135
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

# DH-0135: UI overhaul phase 2: migrate Web client to React

## Summary

Per Fable's DH-0133 design (2026-07-17): migrate src/web/client/render.ts's manual DOM manipulation to React components, section by section (composer first -- the proven DH-0117 bug site -- then sidebar, transcript, header, model picker), each migrated section independently gate-able. state.ts and all non-DOM-mounting modules (sse.ts, commands.ts, download.ts, slash-commands.ts, format.ts, markdown-dom.ts) reused as-is, unmodified. Subsumes DH-0127 (Web flicker/no-vdom) and DH-0129 (auto-scroll-only-when-at-bottom, whose trigger point moves to React's effect model) and DH-0130's Web-side render addition (per-agent terminal-status transcript marker; DH-0130's reducer-side logic is unblocked and can be written first within this ticket). Web domain (Susan).

## User Stories

### As Susan, I want the composer migrated first as its own component, so the DH-0117 focus/text-loss bug is structurally closed before any other section moves

- Given the composer has focus and unsent text, when an unrelated SSE event or the 1s liveness tick fires, then the composer's focus and text are preserved, proven by a React Testing Library test typing into the composer, firing an unrelated state update, and asserting focus/value unchanged (already stated in DH-0133; restated here as this ticket's first landed slice, not deferred to "later work").
- Given the composer component is the first migrated, when the sidebar/transcript/header are still on the old `render.ts` DOM code, then the mixed old/new render tree still produces correct output (composer mounts once via React, everything else keeps being driven by the existing imperative code around it), proven by an integration test asserting no duplicate/missing composer DOM nodes after several old-renderer full-section rebuilds.

### As Susan, I want an `<AppHeader>` component reserved in the new component tree now, so DH-0122 (app header) slots in without a second restructuring later

- Given the new React component tree (root `App` component composing header/sidebar/transcript/composer), when it is first assembled, then it includes an `<AppHeader agentState={...} dhConfig={...} />` slot mounted in the layout position style-guide.md SS5's "startup blocks read as a panel" convention implies (top of the page, above the transcript), proven by a component test asserting `<AppHeader>` exists in the render tree.
- Given DH-0122 has not landed yet, when `<AppHeader>` renders with no header content implemented, then it renders `null` (no visible output, no layout shift, no placeholder text) rather than being omitted from the tree entirely, proven by a test asserting `<AppHeader>` mounts, renders no visible DOM, and reserves no unexpected height/margin.
- Given DH-0122 later fills in `<AppHeader>`'s content (app name, version/build, dh.json config-status summary per DH-0122's own ticket), when that lands, then no other component (sidebar, transcript, composer) needs to change to accommodate it — the slot and its data contract (a props interface `AppHeaderProps` this ticket defines with `null`/empty defaults) already exist, proven by DH-0122's own future implementation requiring zero diff to `App`'s composition beyond `<AppHeader>` itself.

### As Susan, I want the agent tree/sidebar's status dot and connection pill to import color/glyph/word from DH-0137's shared design-token module, so Web's status rendering can't independently drift from the TUI's

- Given DH-0137 (shared design-token module) has landed, when the sidebar's agent-status dot or the connection pill renders, then it looks up color/glyph/word via `STATUS_TOKENS`/`CONNECTION_TOKENS` rather than a locally-declared status-to-color map, proven by a test asserting no `Record<AgentStatus,`-shaped literal exists in the new Web component files (mirrors DH-0137's own grep-based regression test, applied to the consuming side).
- Given a status's color is looked up from the shared module, when style-guide.md's hue map is later amended (a dated change per style-guide.md SS7), then updating `src/design-tokens.ts` alone is sufficient to update both Web and TUI — no `src/web/client/` file needs a matching edit, proven by inspection (the component imports the token, does not hardcode a hex/CSS-var literal itself).

### As Susan, I want the DH-0127 flicker fix and DH-0129 auto-scroll-at-bottom trigger folded into the transcript component's migration, so they don't get implemented twice

- Given a transcript section whose content hasn't changed, when a sibling section re-renders, then the unchanged section's DOM nodes are not replaced, proven by a DOM-node-identity (`===`) test across an unrelated state change (DH-0127's ask, verbatim from DH-0133; DH-0127 itself closes as superseded by this story per DH-0133's recommendation).
- Given the transcript is scrolled exactly to the bottom, when new transcript content arrives, then the view auto-scrolls to reveal it; given the transcript is scrolled up (mid-history), when new content arrives, then the view does NOT force-scroll away from the operator's current read position, proven by a test driving `useEffect`-triggered scroll behavior against both starting scroll positions (DH-0129's ask, implemented once in the new effect model rather than patched into the old imperative code first).

### As Susan, I want DH-0130's per-agent terminal-status transcript marker's render-side half included in the transcript component, so the reducer-side logic already unblocked in `state.ts` has somewhere to render to

- Given `state.ts` already derives a terminal-status marker event for an agent that reaches `done`/`failed`/`stopped` (DH-0130's reducer-side scope, unblocked and framework-agnostic per DH-0133), when the transcript component renders, then it displays that marker using the DH-0137 status tokens (glyph+color+word per the terminal status), proven by a test asserting the marker renders with the correct glyph/color/word for each of the three terminal statuses.

### As the coordinator, I want confirmation this ticket's components read `WebState` without behavioral changes to the reducer, so `state.ts`'s ~850-line test suite stays valid proof throughout the migration

- Given the existing `state.ts` reducer and its test suite, when this ticket's components are built section by section, then `state.ts` requires no behavioral changes beyond DH-0130's reducer-side addition (already unblocked, additive only), proven by `bun test src/web/client/state.test.ts` passing with no edits to that file's existing test cases (new cases may be added for DH-0130).

## Functional Requirements

- Introduce `react` + `react-dom` per DH-0134's toolchain integration (this ticket does not itself add the dependency — DH-0134 is the prerequisite that verifies the build/test pipeline first).
- Migration order (per DH-0133's recommendation, restated as this ticket's plan of record): composer -> sidebar (agent tree, using DH-0137 tokens) -> transcript (folding in DH-0127/DH-0129/DH-0130's render-side work) -> header (reserving the `<AppHeader>` slot per the User Story above, content deferred to DH-0122) -> model picker. Each section is an independently gate-able PR per DH-0133's incremental-migration rationale.
- `state.ts`, `sse.ts`, `commands.ts`, `download.ts`, `slash-commands.ts`, `format.ts`, `markdown-dom.ts` (content logic, not DOM-mount mechanics) reused as-is, unmodified — restated from DH-0133.
- Status/connection color+glyph+word rendering imports from DH-0137's shared module (new requirement from this design pass — DH-0133 didn't specify this level of detail); no section re-declares a status-to-color mapping locally.
- `<AppHeader>` component slot exists from the first PR that assembles the top-level `App` composition (recommend introducing it alongside the composer migration or the first PR that establishes the root `App` shape, whichever comes first structurally) — it does not need to wait until the header section is "its turn" in the migration order, since reserving the slot early is cheap and DH-0122 is queued to land immediately after this ticket.
- DH-0127 and DH-0129's acceptance criteria are satisfied by this ticket's User Stories (see above); once this ticket's transcript-section PR lands with both proven, close DH-0127 (already recommended for closure-by-supersession in DH-0133) and unblock/close DH-0129 accordingly.

## Assumptions

- DH-0134 (Core toolchain) has landed and verified `bun build --compile` bundles React cleanly and React Testing Library works under `bun test` before this ticket's first PR.
- DH-0137 (shared design-token module) lands before or alongside the sidebar-section PR (the first PR that needs status colors) — if DH-0137 is delayed, the sidebar PR blocks on it rather than reimplementing a local status map "temporarily."

## Risks

- Restated from DH-0133: test-rewrite cost (`render.test.ts` is 1038 lines) is the dominant effort driver, larger than writing the new components. Section-by-section migration bounds this per-PR rather than eliminating it.
- `<AppHeader>` rendering `null` correctly (no layout shift) needs an explicit test — an empty-but-mounted component is an easy place for a stray margin/padding to sneak in and be invisible until DH-0122 adds visible content, at which point a spacing bug would look like DH-0122's fault rather than this ticket's.

## Open Questions

- None blocking. Exact prop shape of `AppHeaderProps` beyond "renders null when empty" is DH-0122's own design pass to specify; this ticket only commits to the slot existing and being inert.

## Notes

Updated by Muriel (design crew) 2026-07-17 per the owner's request for a felt-experience design pass on DH-0133 before implementation starts. See `docs/design/style-guide.md` SS1/1.2/2.3 (status/connection tokens) and SS5 (CLI/panel conventions, informing the `<AppHeader>` layout position). Companion ticket: DH-0137 (shared design-token module), DH-0136 (this ticket's TUI counterpart).
