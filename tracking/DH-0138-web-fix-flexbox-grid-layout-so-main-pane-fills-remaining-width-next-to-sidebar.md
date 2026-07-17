---
spile: ticket
id: DH-0138
type: bug
status: verifying
owner: Susan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0138: Web: fix flexbox/grid layout so main-pane fills remaining width next to sidebar

## Summary

Real live layout bug found via screenshot during manual testing 2026-07-17, right after the DH-0135 React migration landed. .dh-app (src/web/client/styles.css) is a 2-column CSS grid (grid-template-columns: 280px 1fr) with no grid-template-rows/areas defined; App.tsx (post-DH-0135) renders three direct children (.app-header-slot, .sidebar, .main-pane), so implicit grid auto-placement puts app-header-slot at row1/col1, sidebar at row1/col2, and main-pane at row2/col1 -- squeezing the transcript/composer into the narrow 280px column with the rest of the window empty/black.

## User Stories

### As an operator, I want the web UI's main pane to use the full available width

- Given the web UI is loaded with a wide viewport, when the page renders, then the sidebar
  occupies a fixed ~280px left column and the main-pane (agent header, transcript, composer)
  fills the remaining width, with the header spanning the full width above both. Verified in
  `e2e/spikes/web/dh-0138-screenshot.ts` (ad-hoc, deleted after use, per 2026-07-17 Notes
  below) via Playwright bounding-box assertions against the real compiled `dh --web` server:
  sidebar box `{x:0, width:280}`, main-pane box `{x:280, width:1000}` at a 1280px viewport,
  header box spanning the full 1280px width.

## Functional Requirements

- `.dh-app` in `src/web/client/styles.css` must lay out `.app-header-slot`, `.sidebar`, and
  `.main-pane` so the header spans full width and sidebar+main-pane sit side by side below
  it, with main-pane taking all remaining horizontal space.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — root cause, fix, and verification

Root cause: `.dh-app` (`src/web/client/styles.css`) is a 2-column CSS grid
(`grid-template-columns: 280px 1fr`) with no `grid-template-rows`/`grid-template-areas`
defined. Post-DH-0135, `App.tsx` renders three direct grid children in this order:
`.app-header-slot`, `.sidebar`, `.main-pane`. With no explicit rows, implicit grid
auto-placement fills left-to-right/top-to-bottom: row1/col1 = header-slot, row1/col2 =
sidebar, row2/col1 = main-pane — squeezing the whole transcript/composer into the narrow
280px column, with row2/col2 left empty (rendering as black, per the reported screenshot).

Fix: added explicit `grid-template-rows: auto 1fr` and `grid-template-areas: "header
header" / "sidebar main"` to `.dh-app`, plus `grid-area` assignments on
`.app-header-slot` (`header`), `.sidebar` (`sidebar`), and `.main-pane` (`main`).

Test discipline (CLAUDE.md §9): this is a layout-only CSS fix — grid placement geometry has
no meaningful unit-test surface in this codebase's existing component/DOM test tier (no
layout engine in the `happy-dom` unit test environment). Verified instead via a real
headless-Chromium run (Playwright, same harness `e2e/web.test.ts` already uses) driving the
actual compiled `dh --web` server: bounding-box measurements confirmed sidebar box
`{x:0, width:280}`, main-pane box `{x:280, width:1000}` (1280px viewport), header box
spanning the full 1280px width, and a screenshot showing correct side-by-side layout with
the header above both. The ad-hoc verification script was not checked in (deleted after
use); this Notes entry plus the User Story above stands as the closure evidence per
CLAUDE.md §9.

Gates run (CLAUDE.md §5): `bun run typecheck` clean. `bun run lint` has 12 pre-existing
failures, none in `src/web/client/styles.css` or any file touched by this change (confirmed
identical failures on the unmodified branch). `bun run test:coverage`: 2114 pass / 0 fail,
100% coverage maintained. `bun run e2e`: 36 pass / 2 fail — both failures reproduce
identically on the unmodified branch (a pre-existing `status-badge` text-casing assertion
mismatch, `"waiting"` vs `"Waiting"`, unrelated to this layout change) — not a regression.

Moving to `verifying`.
