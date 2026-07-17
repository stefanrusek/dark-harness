---
spile: ticket
id: DH-0121
type: feature
status: verifying
owner: stefan
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

# DH-0121: dh needs a logo: SVG + ASCII art versions

## Summary

Owner request from live manual testing 2026-07-17. Need a logo/brand mark in two forms: an SVG (for README, web UI, docs) and an ASCII-art version (for TUI/CLI banner use). Design work -- route through Muriel (Design crew) first per CLAUDE.md's design-crew process, then implementation to whichever domain(s) consume it (Prompt for the shared banner text, Web for the SVG asset, TUI for the ASCII rendering).

## User Stories

### As a docs/Web reader, I want an SVG brand mark, so that README/docs/Web UI can carry a consistent visual identity

- Given `docs/media/logo.svg` exists, when it's opened in a browser or viewed at 24-32px, then the "dh" wordmark and harness-bracket motif remain legible — verified by `src/prompt/banner.test.ts`'s plain-ASCII/structure assertions on the sibling ASCII asset and manual render check (no automated SVG-rendering test exists in this repo; this criterion is closed on visual inspection, noted here per CLAUDE.md §9 rather than silently asserted).

### As a TUI/CLI user, I want an ASCII-art banner, so that DH-0122/DH-0124 can render a startup mark without pulling in non-ASCII bytes that break log aggregators

- Given `DH_ASCII_LOGO` and `DH_ASCII_LOGO_COMPACT` are exported from `src/prompt/banner.ts` (re-exported via `src/prompt/index.ts`), when either is rendered to a plain-ASCII sink, then all bytes fall in the printable ASCII range (`\x20`-`\x7e`) plus `\n` — proven by `src/prompt/banner.test.ts` ("is plain ASCII (no unicode box-drawing or control bytes)", "is a single plain-ASCII line").
- Given `DH_ASCII_LOGO`, when read as a string, then it has no leading/trailing blank lines and spans multiple lines (fits a startup banner without extra padding) — proven by `src/prompt/banner.test.ts` ("has no leading/trailing blank lines", "spans multiple lines").

## Functional Requirements

- An SVG logo at `docs/media/logo.svg`, dark-theme by default (matches `src/web/client/styles.css`'s `--bg: #0b0d12`), legible at small sizes (favicon/header use).
- An ASCII-art export from `src/prompt/` (this domain already owns shared banner/skill text per CLAUDE.md §3's Prompt row), plain-ASCII only, for TUI/CLI consumption by DH-0122/DH-0124.

## Assumptions

- DH-0122/DH-0124 will import `DH_ASCII_LOGO`/`DH_ASCII_LOGO_COMPACT` from `src/prompt/` rather than duplicating banner text — no existing precedent for banner text elsewhere in the repo (checked: no prior `banner`/`ASCII` logo constant existed before this ticket).

## Risks

- None significant — additive-only files, no wiring into the live startup path yet (that's DH-0122/DH-0124's job), so no runtime risk from landing this early.

## Open Questions

- None.

## Notes

### 2026-07-17 — design + implementation (dispatched directly, small/self-contained per owner's routing)

This ticket named Muriel/Design-crew as the normal routing (CLAUDE.md §7), but the owner
dispatched it directly given the small, self-contained scope. Design choices below, for
Muriel to review/veto on the next design pass if she'd have gone a different direction:

- **Motif:** two rounded harness/carabiner-style brackets (`⊂ ⊃`-ish, drawn as simple
  polylines) clasping a monospace "dh" wordmark, with a small green dot beneath standing in
  for an "agent" node. Reads as "harness" (the brackets literally clasp the mark) without
  needing a literal harness/rope illustration, which doesn't miniaturize well.
- **Palette:** pulled straight from the existing Web dark theme (`--bg: #0b0d12` panel,
  `--status-running` blue `#4f8cff` for the brackets, `--status-done` green `#35c469` for the
  agent-node accent) rather than inventing new brand colors — style-guide.md §"Color is an
  accent" already established this palette as canonical across surfaces, so the logo
  inherits it instead of competing with it.
- **ASCII art:** kept to plain printable ASCII (no Unicode box-drawing), matching the
  existing precedent at `src/cli.ts`'s `CLI_*` SGR-gating comment (non-TTY/log-aggregator
  output must stay byte-plain). Two exports: `DH_ASCII_LOGO` (5-line figlet-style block, for
  a startup splash with room) and `DH_ASCII_LOGO_COMPACT` (`[ dh ]`, single line for narrow
  terminals or inline status-bar use) — mirrors the "wordmark vs. lockup" convention SVG
  logos usually ship as two variants.
- **Location:** SVG under `docs/media/` (existing directory, already holds
  `hero-web-dark.png`/`hero-web-light.png`). ASCII export under `src/prompt/banner.ts`,
  re-exported from `src/prompt/index.ts` — Prompt already owns "shared banner text" per
  CLAUDE.md §3's ownership table, and this keeps it in one place for both TUI (Mary) and any
  future CLI (Grace) consumer to import rather than duplicate.
- Not wired into any live startup path — that's DH-0122/DH-0124's job per the original
  ticket's routing note. This ticket only produces the assets.

Gates run: `bun run typecheck` (pass), `bunx biome check` on the new/changed files only
(pass — pre-existing repo-wide lint failures on unrelated files are untouched by this
change), `bun test src/prompt/banner.test.ts --coverage` (100% funcs/lines on the new file).
