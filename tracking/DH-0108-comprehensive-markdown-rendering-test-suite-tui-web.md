---
spile: ticket
id: DH-0108
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0056]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0108: Comprehensive Markdown rendering test suite (TUI+Web)

## Summary

DH-0056's Markdown rendering (shared parser in src/markdown/, TUI's SGR-only ANSI renderer, Web's sanitized HTML renderer) has good unit coverage per-function but no comprehensive test suite systematically exercising every supported CommonMark construct (headings 1-6, bold, italic, strikethrough, code spans, fenced code blocks with language info, blockquotes including nested, ordered/unordered lists including nested, links, thematic breaks) across both renderers with matching expected-output fixtures, plus the explicitly-out-of-scope constructs (tables, setext headings, reference-style links) verified to degrade gracefully rather than break. Owner explicitly asked for this after confirming DH-0056 itself is done: a real markdown-conformance test matrix, run now, not just left as a ticket.

## User Stories

### As a maintainer, I want one authoritative fixture set proving every supported Markdown construct renders correctly on both clients

- Given a fixture input exercising a specific construct (e.g. a fenced code block with a
  language tag), when rendered through the TUI's ANSI renderer and the Web's HTML renderer,
  then both produce output matching a pinned expected value — a future change to either
  renderer that breaks a construct fails a test immediately, not "eventually noticed live."

### As a maintainer, I want the explicitly-out-of-scope constructs to degrade safely, not silently misbehave

- Given a table, setext heading, or reference-style link (DH-0056's documented exclusions),
  when rendered, then it degrades to plain/literal text cleanly on both clients — no crash,
  no malformed ANSI, no unsanitized HTML passthrough.

## Functional Requirements

- One shared fixture table (construct name → Markdown input → expected TUI ANSI output →
  expected Web HTML/DOM shape) covering: headings 1–6, bold, italic, strikethrough, inline
  code, fenced code blocks (with and without a language tag), blockquotes (including nested),
  ordered and unordered lists (including nested, including mixed), links, thematic breaks.
  Add the three documented exclusions (tables, setext headings, reference-style links) with
  an explicit "degrades to literal text, no crash" assertion each. Every row in the fixture
  table is itself an acceptance criterion needing a real test file+case per Constitution §9.
- Lives alongside the existing `src/markdown/`, `src/tui/markdown-ansi.test.ts`,
  `src/web/client/markdown-dom.test.ts` suites — implementer's call whether to add one new
  shared fixture file both existing test files import, or keep it distributed, as long as
  the coverage is genuinely comprehensive and traceable per construct.
- 100% coverage per CLAUDE.md §5 on any new code; per this session's CLAUDE.md §9 rule, this
  ticket IS the test-coverage work, so its own closure requires the suite to exist and pass,
  not a promise to add it later.

## Assumptions

- No new Markdown features are being added here — this is pure test coverage over what
  DH-0056 already shipped.

## Risks

- None beyond normal test-authoring risk; this is additive test coverage with no production
  code behavior change expected (a construct that fails once the suite exists would surface
  a real pre-existing bug worth its own fix, not a reason to change the test).

## Open Questions

## Notes

> [!NOTE]
> Filed 2026-07-16 per owner instruction immediately after confirming DH-0056 was done:
> "We should have a comprehensive markdown test suite. This ticket is done. Make a ticket for
> the test suite. Run it!" — dispatched for implementation the same day, not left queued.
