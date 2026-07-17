---
spile: ticket
id: DH-0109
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: [DH-0108]
  relates_to: [DH-0056]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0109: Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs)

## Summary

DH-0056 (Render agent output as Markdown, TUI+Web) deliberately scoped out several CommonMark/GFM constructs as 'future extension': tables (rows show as literal pipe text), setext-style headings, and reference-style links/images. This ticket tracks adding real support for each, with one user story per feature so they can be prioritized/implemented independently rather than as one monolithic follow-up. Depends on DH-0108's test suite landing first so each new feature gets fixture coverage from day one instead of retrofitted.

## User Stories

### As an operator, I want GFM tables rendered as real tables, not literal pipe text

- Given agent output containing a GFM table, when rendered in the TUI, then it displays as an
  aligned, bordered text table (box-drawing or padded-column ASCII, implementer's call
  matching this project's existing terminal-chrome conventions) rather than raw `| a | b |`
  syntax.
- Given the same table rendered in the Web UI, then it displays as a real HTML `<table>` with
  the existing Markdown-surface CSS styling extended to cover it.

### As an operator, I want setext-style headings (`===`/`---` underlines) recognized

- Given a heading written in setext form instead of ATX (`#`) form, when rendered, then it's
  treated identically to the equivalent ATX heading on both clients, not left as literal text.

### As an operator, I want reference-style links/images to resolve

- Given a Markdown document using `[text][ref]` + a `[ref]: url` definition elsewhere in the
  same turn, when rendered, then the link resolves the same as an inline `[text](url)` link on
  both clients.

## Functional Requirements

- Each user story above is independently implementable and independently valuable — do not
  require all three to ship together. Prioritize tables first (the most commonly hit in
  practice per the DH-0056 finding that surfaced this gap).
- Extend `src/markdown/`'s shared `BlockNode`/`InlineNode` AST with new node kinds per feature
  (`table`, and reference-link resolution can likely stay within existing `link` inline nodes
  if resolved at parse time) rather than a per-client parallel implementation.
- Per Constitution §9: each user story's acceptance criteria need real tests (extending
  DH-0108's fixture suite, once that lands) before any of these closes.

## Assumptions

- DH-0108's fixture-suite infrastructure exists and is the natural home for these features'
  test coverage — implement against it rather than a parallel ad hoc test file.

## Risks

- Table rendering in a terminal is the fiddliest of the three (column-width computation,
  wrapping behavior on narrow terminals, alignment markers `:---:`/`---:`) — expect this to
  need its own design/implementation care, not a quick add.

## Open Questions

- Terminal table rendering style (box-drawing vs. padded ASCII) — implementer's call unless
  the design-crew (Muriel) wants to weigh in per `docs/design/style-guide.md`'s conventions.

## Notes

> [!NOTE]
> Filed 2026-07-16 per owner instruction, split from DH-0056's "future extension" note. One
> ticket, three independent user stories (per Spile's one-ticket-per-related-story-group
> convention) rather than three separate tickets, since they share the same root cause
> (constructs DH-0056 explicitly deferred) and the same test infrastructure (DH-0108).

> [!NOTE]
> 2026-07-17: All three user stories implemented in `src/markdown/index.ts` (shared AST +
> parser), `src/tui/markdown-ansi.ts` (TUI renderer), and `src/web/client/markdown-dom.ts` +
> `styles.css` (Web renderer), extending DH-0108's shared `rendering-fixtures.ts` per the
> ticket's assumption.
>
> - **GFM tables**: new `BlockNode` kind `table` (`align`/`header`/`rows`), parsed from a
>   pipe-delimited header row + `---`/`:---`/`---:`/`:---:` delimiter row, with row-length
>   normalization (pad short rows, truncate long ones) and escaped-pipe (`\|`) cell support.
>   TUI renders a box-drawing bordered table with alignment-aware padding
>   (`renderTableBlock`/`renderTableRow` in `markdown-ansi.ts`); Web renders a real
>   `<table><thead>/<tbody>` with `text-align` styles, plus new `.turn-text table/th/td` CSS.
>   Acceptance criteria proven by: `src/markdown/index.test.ts` ("GFM tables parse to a table
>   node (DH-0109)", "GFM table alignment markers (DH-0109)", escaped-pipe/row-normalization
>   tests), the shared fixtures "GFM table" / "GFM table with alignment markers" in
>   `src/markdown/rendering-fixtures.ts` (run by both `src/tui/markdown-ansi.test.ts` and
>   `src/web/client/markdown-dom.test.ts`), plus dedicated Web tests in
>   `markdown-dom.test.ts` for alignment/empty-body rendering.
> - **Setext headings**: `Title\n===` / `Subtitle\n---` now parse as h1/h2 (`matchSetextUnderline`
>   in `index.ts`), taking precedence over a bare `-` thematic break only when it directly
>   follows in-progress paragraph text (matches CommonMark precedence). Proven by:
>   `index.test.ts` ("setext-style headings parse as h1/h2 (DH-0109)", "a standalone thematic
>   break with no preceding paragraph stays a thematic break") and the shared fixtures
>   "setext h1" / "setext h2".
> - **Reference-style links/images**: `[ref]: url` definitions are extracted up front
>   (`extractReferenceDefinitions`) into a label→url map threaded through `parseInline`,
>   resolving `[text][ref]` and the collapsed `[ref][]` form; images degrade to links as
>   before. Proven by: `index.test.ts` ("reference-style links resolve...", "collapsed
>   reference-style links...", "an unresolved reference-style link stays literal text") and
>   the shared fixtures "reference-style link" / "excluded: unresolved reference-style links
>   degrade to literal text".
>
> Gates: `bun run typecheck` clean; `bun run lint` clean for all touched files (pre-existing
> unrelated lint failures in `src/agent/providers/openai-compatible.ts` and
> `.claude/skills/forked-subagent/` left untouched, out of this ticket's scope);
> `bun test src --coverage` — 100% funcs/lines on every touched file
> (`src/markdown/index.ts`, `src/markdown/rendering-fixtures.ts`, `src/tui/markdown-ansi.ts`,
> `src/web/client/markdown-dom.ts`), 2128 pass / 0 fail repo-wide; `bun run e2e` — the 13
> failures present (tmux-PTY-pane + exit-code-matrix issues) are pre-existing on the
> unmodified tree, confirmed via `git stash` A/B before touching this ticket's files, not
> caused by this change.
