---
spile: ticket
id: DH-0109
type: feature
status: draft
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
