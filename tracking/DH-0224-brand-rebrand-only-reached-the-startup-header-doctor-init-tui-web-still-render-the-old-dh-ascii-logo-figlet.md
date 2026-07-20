---
spile: ticket
id: DH-0224
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0219]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0224: Brand rebrand only reached the startup header; doctor/init/TUI/Web still render the old DH_ASCII_LOGO figlet

## Summary

DH-0219/DH-0220 introduced the new DH monogram + ANSI-Shadow wordmark (HEADER_A2_WORDMARK / HEADER_B_GLYPH) but only for the run.ts startup header. Every other surface still prints the pre-rebrand DH_ASCII_LOGO / DH_ASCII_LOGO_COMPACT figlet via header-info.ts's formatHeaderLines/formatEmptyStateLines: 'dh doctor' and 'dh init' (printAppHeader in cli/activity-feed.ts), the TUI empty-state (RootView), and the Web AppHeader logo. Result is two coexisting visual identities for the same product. Spans Core (activity-feed/header-info), TUI, and Web — cannot be cleanly sliced to one owner per CLAUDE.md §3; flag for coordinator triage on decomposition (whether secondary surfaces adopt the monogram, and who owns each). Note also the stale TODO at src/tui/ink/Header.tsx:10 referencing DH-0124's empty variant.

## User Stories

### As an operator running `dh doctor` or `dh init`, I want the same brand identity the interactive startup header uses

- Given a TTY run of `dh doctor` or `dh init`, when the header block prints, then the logo line
  is Header B's compact two-line block glyph (`HEADER_B_GLYPH`, `banner.constant.ts`) rather
  than the pre-rebrand `DH_ASCII_LOGO` figlet — verified by
  `src/header-info.test.ts` ("formatHeaderLines includes the full logo by default...", asserting
  against `info.logoFull`, which `buildHeaderInfo` now sources from `HEADER_B_GLYPH.join("\n")`).

### As a TUI user, I want the pre-first-message empty state to show the new brand mark

- Given a fresh TUI session with no turns yet, when the root view's empty state renders, then it
  shows the shared `HEADER_A2_WORDMARK_PLAIN` ("DARK HARNESS") one-liner instead of the old
  `DH_ASCII_LOGO_COMPACT` ("[ dh ]") — verified by `src/tui/ink/RootView.test.tsx` ("compact logo
  + version line, then a blank line..." and the `RootView` "before any turns exist..." case, both
  asserting `HEADER_A2_WORDMARK_PLAIN` appears).

### As a maintainer, I want every header-consuming surface to pull from one source of truth, not re-declare art

- Given `header-info.ts`'s `buildHeaderInfo`, when any surface (CLI `printAppHeader`, TUI
  `RootView`, Web `AppHeader`) asks for `logoFull`/`logoCompact`, then all three read the same
  `banner.constant.ts` exports — no surface hand-rolls its own ASCII/text logo — verified by
  `src/header-info.test.ts`'s `buildHeaderInfo`/`formatHeaderLines`/`formatEmptyStateLines`
  suite, which is the single place these constants are wired in.

### As a future reader of `src/tui/ink/Header.tsx`, I want its `"empty"` variant comment to be accurate, not stale

- Given the file's header comment previously said DH-0124 would "populate" the `"empty"`
  variant, when read today, then it correctly explains that DH-0124's actual empty-state content
  ships through `RootView.buildRootEmptyText` instead, and no caller ever passes
  `variant: "empty"` — this is a doc-only fix with no separate runtime behavior to test beyond
  the existing `RootView`/`Header` test suites already covering both code paths.

## Functional Requirements

- `header-info.ts`'s `buildHeaderInfo` sources `logoFull`/`logoCompact` from
  `src/prompt/banner.constant.ts`'s DH-0220 exports (`HEADER_B_GLYPH`, `HEADER_A2_WORDMARK_PLAIN`)
  instead of the pre-rebrand `DH_ASCII_LOGO`/`DH_ASCII_LOGO_COMPACT`.
- `logoFull` (used by `dh doctor`/`dh init` on a TTY, non-compact) uses Header B's compact
  two-line glyph rather than Header A2's full 12-line wordmark — those commands are quick
  utility output, not a splash screen, and don't have the vertical budget for the full banner
  (judgment call, this ticket).
- `logoCompact` (TUI `RootView` empty-state, Web `AppHeader`'s compact status-bar tag) uses the
  plain-text `"DARK HARNESS"` fallback wordmark — the only single-line brand asset
  `banner.constant.ts` exports.
- No consuming surface (CLI, TUI, Web) re-declares ASCII/text brand art locally; all read
  through `header-info.ts` -> `banner.constant.ts`.
- Web's `AppHeader` (the compact status-bar row) is left using `header-info.ts`'s shared
  `logoCompact` text tag; it is a different piece of chrome from `App.tsx`'s sidebar `.brand`
  row, which already renders the DH-0219 `LogoMark.tsx` SVG monogram next to "Dark Harness" —
  the two were checked and found not to conflict (one is a compact identity tag in a dense
  status strip, the other is the sidebar's primary brand mark).
- `src/tui/ink/Header.tsx`'s stale DH-0124-referencing comment is corrected to describe where
  the empty-state content actually lives (`RootView.buildRootEmptyText`).

## Assumptions

- Header B's two-line glyph is an acceptable trade for `doctor`/`init`'s logo (vs. Header A2's
  full wordmark) given those commands' narrower space budget — no dedicated single-line/compact
  brand asset exists beyond the plain-text wordmark fallback, so reusing existing
  `banner.constant.ts` exports (rather than inventing a new one) was preferred, per the ticket's
  "no re-declaration of ASCII art in multiple places" instruction.

## Risks

## Open Questions

## Notes

### 2026-07-19 — implementation, verifying

Implemented per the coordinator's single-pass scope call (see ticket Summary): `header-info.ts`
now sources `logoFull`/`logoCompact` from DH-0220's `banner.constant.ts` exports
(`HEADER_B_GLYPH`, `HEADER_A2_WORDMARK_PLAIN`), which automatically brings `dh doctor`, `dh
init` (via `printAppHeader`), the TUI empty-state (`RootView`), and Web's `AppHeader` onto the
new brand — all four read through the same shared builder, so no per-surface change was needed
beyond that one function. Also fixed the stale DH-0124 TODO in `src/tui/ink/Header.tsx`'s header
comment (its `"empty"` variant was never actually wired to a caller; the real empty-state content
ships through `RootView.buildRootEmptyText`).

Checked Web's `AppHeader` against DH-0219's `LogoMark.tsx` SVG monogram per the ticket's ask:
`App.tsx`'s sidebar already renders `<LogoMark className="brand-mark" />` next to "Dark
Harness" (DH-0219, already on-brand). `AppHeader`'s compact status-bar tag is a separate,
narrower piece of chrome (12px bold text next to version/config in a dense single row) — kept
as a shared-text tag rather than duplicating the SVG there, now sourced from the same
`logoCompact` constant as CLI/TUI.

Gates: `bun run typecheck`/`bun run lint`/`bun run test:coverage` all show pre-existing/
concurrent failures from other tickets actively landing on this shared branch at the same time
(DH-0057's `src/agent/mcp/{manager,oauth-provider}.ts`, DH-0223's `src/cli/header.test.ts`,
flaky/unrelated `src/agent/runtime.test.ts` and `src/web/client/app.test.ts` cases) — none touch
this ticket's four changed files (`src/header-info.ts`, `src/header-info.test.ts`,
`src/tui/ink/Header.tsx`, `src/tui/ink/RootView.test.tsx`), confirmed by isolating those files'
own test run (24/24 pass) and grepping the full typecheck/lint output for their paths (no
matches). `bun run e2e` not run standalone given the shared branch's build instability at commit
time; the changed surfaces are otherwise fully covered by the unit suite. Committed as f6d23c3
(pushed to `claude/coordinator-onboarding-kab9ls`).
