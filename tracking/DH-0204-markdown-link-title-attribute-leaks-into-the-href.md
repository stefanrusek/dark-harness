---
spile: ticket
id: DH-0204
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0109]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0204: Markdown: link title attribute leaks into the href

## Summary

Manual testing finding (2026-07-19): [text](url "title") syntax puts the title text into the rendered href attribute instead of using it as a tooltip (or dropping it gracefully). Real parsing/rendering bug in the markdown pipeline. Related to DH-0109's reference-link work. Domain: wherever src/markdown/ is owned (check current ownership post-refactor).

## User Stories

### As a user reading markdown links rendered from assistant output, I want a `[text](url "title")` link's `href` to be exactly `url`, with `title` (if present) used only as a tooltip, so links resolve correctly instead of navigating to a broken URL containing the title text.

- Given inline markdown `[link](https://x.example "a title")`, when it's parsed, then the resulting `link` AST node has `url: "https://x.example"` and a separate `title: "a title"` field — the title text is never appended into `url`. Proven by the new "link with title" fixture in `src/markdown/rendering-fixtures.ts`, exercised (and asserted against the AST-derived TUI/DOM output) in `src/tui/markdown-ansi.test.ts` and `src/web/client/markdown-dom.test.ts`.
- Given that same markdown rendered to Web DOM, when the anchor is inspected, then `href` resolves to `https://x.example/` and `title` (the HTML tooltip attribute) is `"a title"`. Proven by `src/web/client/markdown-dom.test.ts` via the shared "link with title" fixture.
- Given a link with no title, `[link](https://x.example)`, when parsed/rendered, then behavior is unchanged from before (no `title` field/attribute at all). Proven by the existing "link" fixture in `src/markdown/rendering-fixtures.ts`.

## Functional Requirements

- `src/markdown/index.ts`: `parseLinkLike`/new `splitLinkDestination` helper splits `(url "title")` / `(url 'title')` into separate `url`/`title` before constructing the `link` AST node; malformed/untitled destinations still fall back to treating the whole parenthesized content as `url` (unchanged prior behavior).
- `src/web/client/markdown-dom.ts`: sets `anchor.title` from the node's `title` when present.
- TUI (`src/tui/markdown-ansi.ts`) already renders only `node.url`, never a title, so no leak existed there — no change needed beyond the shared AST field being available.

## Assumptions

- Only inline link syntax `[text](url "title")` was in scope, per the ticket; reference-style definitions (`[ref]: url "title"`) were left as documented pre-existing non-support (they already don't match `REF_DEFINITION_RE` and degrade to literal text).

## Risks

- None identified; change is additive (new optional AST field) and doesn't alter untitled-link parsing.

## Open Questions

## Notes

### 2026-07-19 — implementation

Added `splitLinkDestination` in `src/markdown/index.ts` to separate `(url "title")` into
`{ url, title }` before the `link` AST node is built (both inline-link and image-link call
sites use it via a new `makeLinkNode` helper that omits `title` entirely when absent, to
satisfy `exactOptionalPropertyTypes`). `src/web/client/markdown-dom.ts` sets `anchor.title`
when present. Verified: `bun run typecheck`, `bun run test:coverage` (100% lines on all
changed files), `bun run e2e` all green. `bun run lint` fails independent of these changes
(pre-existing biome config error, confirmed via `git stash`).
