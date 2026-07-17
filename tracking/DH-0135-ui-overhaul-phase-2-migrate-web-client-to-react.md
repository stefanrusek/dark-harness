---
spile: ticket
id: DH-0135
type: feature
status: verifying
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

### 2026-07-17 — composer + `<AppHeader>` slot implemented, ready for verification

- Migrated the composer (`renderComposer` in `render.ts`) to a real React component,
  `src/web/client/components/Composer.tsx`. Sidebar/transcript/header/model-picker remain on
  the old imperative `render.ts` code, per the ticket's section-by-section plan — composer
  first, other sections in follow-up tickets. `Composer` uses an uncontrolled (ref-based)
  `<textarea>`, matching the old imperative behavior byte-for-byte (`.value` read on submit,
  cleared after send) rather than a controlled `value`/`onChange` pair, which kept the
  existing DOM-level integration tests (`app.test.ts`) valid with only one addition (a
  `.focus()` call before a synthetic `keydown`, needed because React's `ChangeEventPlugin`
  tracks `keydown` against whichever element last received a real `focus` event — ambient
  under a real browser, not implied by a raw `dispatchEvent` in a test harness).
- React's reconciliation (same component/position across `renderAll()` passes) structurally
  closes the DH-0117 focus/text-loss bug — no more hand-written
  `container.dataset.composerRendered` idempotency guard. Added a direct DH-0117 regression
  test (`Composer.test.tsx` + an end-to-end `app.test.ts` case) asserting focus and unsent
  text survive an unrelated SSE event and the liveness tick, and an integration test
  asserting the composer's React root mounts exactly once (no duplicate/missing DOM nodes)
  across several old-renderer full-section rebuilds.
- Added the reserved `<AppHeader>` slot (`src/web/client/components/AppHeader.tsx`,
  `AppHeaderProps` with `agentState`/`dhConfig` typed `unknown | null`, renders `null`),
  mounted at the top of the page via a new `appHeaderSlot` container in `buildShell`
  (`render.ts`), above the sidebar/main row. `AppHeader` and `Composer` are each mounted via
  their own `react-dom` root in `app.ts` (not yet unified under one top-level `<App>` tree,
  since sidebar/transcript/header are still old-renderer DOM this round) — full composition
  follows naturally once those sections migrate in their own tickets.
- `src/web/tsconfig.json` gained `"jsx": "react-jsx"` (mirrors `src/tui/tsconfig.json`'s
  existing isolated-program pattern from DH-0134).
- Cross-cutting test-infra fix, discovered while landing this: `bun test src` (no
  `--parallel=1`) doesn't strictly serialize test files — with 90+ files in this suite,
  some files' async test bodies run concurrently in the same process. Registering
  `globalThis.window`/`document` per-test (toggled on/off) was observable by an unrelated
  test elsewhere mid-run, tripping the Anthropic SDK's `isRunningInBrowser()` check
  (`src/agent/providers/anthropic.ts`, Core-owned, not touched) in 3 unrelated tests.
  Fixed by registering `window`/`document`/`HTMLElement` once, permanently, at first
  `test-dom.ts` import (each test still gets its own isolated happy-dom `Window`/`root`
  threaded through explicitly — only the *ambient* globals are shared) and overriding
  `navigator` to `undefined` permanently alongside them (Bun always provides a real
  `navigator`; that's the one leg of Anthropic's three-way check this fix needs to
  neutralize). Also added `--parallel=1` to `package.json`'s `test`/`test:coverage` scripts
  as defense in depth — confirmed necessary and sufficient on its own, kept alongside the
  above for belt-and-suspenders. Flagging for Core/coordinator visibility since this touches
  `package.json`'s shared scripts, not just `src/web/`.
- `state.ts` untouched, beyond what DH-0130 already unblocked separately (not touched this
  round either — out of scope for the composer/header slice).
- User Stories → tests: story 1 (composer bullet 1, focus/text preserved) →
  `Composer.test.tsx` "DH-0117 regression..." + `app.test.ts` "DH-0135: the composer's focus
  and unsent text survive..."; story 1 (bullet 2, mixed old/new tree renders correctly) →
  `app.test.ts` "DH-0135: the React-mounted composer mounts exactly once..."; story 2
  (`<AppHeader>` slot exists, renders `null`, no layout shift) → `AppHeader.test.tsx` both
  cases + `render.test.ts`'s `buildShell` assertions on `.app-header-slot`; story 2 (bullet
  3, DH-0122 needs zero diff to `App`'s composition) → satisfied by construction
  (`AppHeaderProps` defined now, `AppHeader` mounted independently — no test can prove a
  future ticket's diff size, noted as a design commitment rather than a test); story 5
  (`state.ts` unchanged) → `bun test src/web/client/state.test.ts` passes with zero edits to
  that file, confirmed as part of this round's gate run.
  Sidebar-token story (STATUS_TOKENS import) and the transcript/DH-0127/DH-0129/DH-0130
  stories are explicitly **not** in this round's scope — composer + `<AppHeader>` slot only,
  per the ticket's own section-by-section plan. Left for the sidebar/transcript follow-up
  tickets.
- Gates run: `bun run typecheck` clean (root + `src/web` + `src/tui` programs);
  `bun run lint` clean on all touched/new files (pre-existing unrelated errors in
  `.claude/skills/forked-subagent/` and `src/agent/providers/openai-compatible.ts` are
  untouched, confirmed present on the base branch too); `bun run test:coverage` 2114 pass /
  0 fail, 100% coverage on `Composer.tsx`/`AppHeader.tsx`/`test-dom.ts`; `render.ts`'s
  89.66%-funcs/100%-lines gap on `app.ts` and 96.88%/99.13% gap on `render.ts` are both
  pre-existing on the base branch (confirmed via `git stash` diff), not introduced here;
  `bun run e2e` 33 pass / 5 fail, same 5 failures reproduce identically on the base branch
  (sandbox tmux/PTY limitation per DH-0134's own note, not this ticket).
