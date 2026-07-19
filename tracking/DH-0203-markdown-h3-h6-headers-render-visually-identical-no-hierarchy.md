---
spile: ticket
id: DH-0203
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0108, DH-0109]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0203: Markdown: H3-H6 headers render visually identical, no hierarchy

## Summary

Manual testing finding (2026-07-19): only H1/H2 have distinct visual styling in the Web markdown renderer; H3 through H6 all render identically, losing document hierarchy for content that uses deeper heading levels. Needs a real (even if subtle) size/weight scale across all six levels. Web domain (Susan), touches shared markdown rendering (src/markdown/) -- check TUI too once TUI verification is unblocked.

## User Stories

### As a user reading assistant markdown output, I want H3-H6 headings to be visually distinct from each other and from H1/H2, so document hierarchy is legible instead of every sub-heading looking like plain bold prose.

- Given Web-rendered markdown containing h1 through h6, when each heading level is inspected, then each level has its own font-size/weight point on a decreasing scale rather than H3-H6 collapsing to one identical style. Proven by `src/markdown/rendering-fixtures.ts` "heading h3".."heading h6" fixtures exercised in `src/web/client/markdown-dom.test.ts` (DOM shape) and `src/web/client/styles.css` rules `.turn-text h3`..`.turn-text h6`.
- Given TUI-rendered markdown containing h1 through h6, when each heading level's ANSI row is inspected, then h4-h6 are distinguishable from h1-h3 (dim added on top of bold+cyan) rather than every non-h1 level sharing byte-identical SGR codes. Proven by `src/markdown/rendering-fixtures.ts` "heading h3".."heading h6" fixtures exercised in `src/tui/markdown-ansi.test.ts`.

## Functional Requirements

- `src/web/client/styles.css`: distinct `font-size` (and, for h5/h6, weight/transform) per heading level `.turn-text h1`..`.turn-text h6`.
- `src/tui/markdown-ansi.ts` `renderBlock`'s `"heading"` case: h1 keeps bold+underline, h2/h3 keep bold+cyan, h4-h6 additionally carry dim, so the six levels aren't split into only two buckets.

## Assumptions

- The underlying AST already carries `level: 1 | 2 | 3 | 4 | 5 | 6` (src/markdown/index.ts) unchanged; this is styling-only, no parser change.

## Risks

- None beyond visual regression, covered by the fixture-driven tests shared between TUI/Web.

## Open Questions

## Notes

### 2026-07-19 — implementation

Web: `src/web/client/styles.css` now gives h3 (1.05em), h4 (1em), h5 (0.925em, uppercase),
h6 (0.85em, uppercase, dimmed color) — a full six-point scale instead of h3-h6 sharing 1em.
TUI: `src/tui/markdown-ansi.ts` keeps h1 bold+underline and h2/h3 bold+cyan, but h4-h6 now
also carry `SGR.dim`, so the TUI has a visible hierarchy cue too instead of h2-h6 sharing one
style. Both shared fixtures in `src/markdown/rendering-fixtures.ts` updated/extended and
exercised in both `src/tui/markdown-ansi.test.ts` and `src/web/client/markdown-dom.test.ts`.
Verified: `bun run typecheck`, `bun run test:coverage` (100% lines on all changed files),
`bun run e2e` all green. `bun run lint` fails on this repo checkout independent of these
changes (pre-existing `biome.json` "unknown key `include`" config error, confirmed via
`git stash` before touching any files).
