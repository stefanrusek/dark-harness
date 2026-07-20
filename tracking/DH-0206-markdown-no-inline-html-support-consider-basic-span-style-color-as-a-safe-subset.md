---
spile: ticket
id: DH-0206
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0206: Markdown: no inline HTML support -- consider basic <span style=color> as a safe subset

## Summary

Manual testing finding (2026-07-19): <span style="color: red;">text</span> doesn't render at all today. Owner-adjacent suggestion from the testing pass: full inline HTML is out of scope/unsafe, but a narrow allowlisted subset (just <span style="color: ...">) could enable simple inline coloring in both Web and TUI without a full HTML-support surface. Needs a security-conscious scoping pass (allowlist approach, not general HTML passthrough) before implementation -- flag for architect review given this touches untrusted-content rendering.

**Architect decision (2026-07-19, Fable): BLESSED as scoped, with an ADR.** See ADR 0009
(`docs/adr/0009-markdown-colored-span-subset.md`) — that ADR is the authoritative spec (exact
grammar regex, allowlist, renderer integration, adversarial test list). This ticket's sections
below restate it in ticket form. Build against ADR 0009.

## User Stories

### As an operator reading a transcript, I want a model's `<span style="color: …">` to color the text

- Given model output `<span style="color: red;">alert</span>`, when it renders in the Web
  client, then a `<span>` element is produced with `style.color === "red"` wrapping "alert".
  → `src/web/client/markdown-dom.test.ts` (coloredSpan Web case).
- Given the same output, when it renders in the TUI, then "alert" is wrapped in SGR `31` with a
  trailing reset and the row stays self-contained.
  → `src/tui/markdown-ansi.test.ts` (coloredSpan named-color case).
- Given `<span style="color: #ff0000">alert</span>` (hex), when it renders in the TUI, then
  "alert" renders as plain uncolored text (no color SGR emitted), because this renderer is
  16-color-only and constructs no free-form ANSI from the value; and when it renders in Web,
  `style.color === "#ff0000"`.
  → `markdown-ansi.test.ts` (hex → plain) and `markdown-dom.test.ts` (hex Web case).

### As a security reviewer, I want every non-exact / hostile span shape to stay literal text

- Given any of the ADR 0009 adversarial inputs (`url(`, `expression(`, `javascript:`, a
  second `;`-separated declaration, an extra attribute after the close quote, a quote inside
  the value, an unclosed span, a stray `</span>`, a nested span, `<div style=…>`, `<span>`
  with no style), when parsed, then **no `coloredSpan` node is produced** and the input renders
  as literal/plain text — never as styled markup.
  → `src/markdown/index.test.ts` (adversarial cases 1–9, 11 in ADR 0009).
- Given a valid span in mixed case, single- or double-quoted, with or without a trailing `;`,
  when parsed, then exactly one `coloredSpan` node is produced carrying the lowercased,
  normalized color.
  → `src/markdown/index.test.ts` (happy-path case 10 in ADR 0009).

## Functional Requirements

1. Add `{ kind: "coloredSpan"; children: InlineNode[]; color: string }` to `InlineNode` in
   `src/markdown/index.ts`. No other new node type; no general HTML node.
2. Recognize the opening tag with the exact anchored, case-insensitive regex in ADR 0009
   (`COLORED_SPAN_OPEN`), require a literal first `</span>` to close, and gate construction on
   `validateColor(...) !== null` (hex `#rgb`/`#rrggbb`, or membership in the frozen
   `NAMED_COLORS` set). Fail closed to literal text on any miss (bad shape, bad color, no
   close).
3. Web renderer sets `element.style.color` via property assignment only — never a string-built
   `style="…"` attribute, never `innerHTML`.
4. TUI renderer maps named colors to the existing 16-color SGR allowlist via a fixed
   `NAME_TO_SGR` table; hex values and unmapped names render plain (no color). No 256/truecolor,
   no color-level plumbing.
5. Amend the `src/markdown/index.ts` file header: still no general HTML node / raw HTML still
   literal, but one recognized allowlist-validated `coloredSpan` construct now exists; cite
   ADR 0009.
6. Full adversarial + happy-path test coverage per ADR 0009 (100% coverage gate, CLAUDE.md §5).

## Assumptions

- Curated `NAMED_COLORS` (12 keywords) is sufficient for a first cut; hex covers arbitrary
  colors on Web. Widening the named set later is a safe follow-up (all CSS names are
  letters-only).
- Owner of each file per CLAUDE.md §3: Core owns `src/markdown/` and signs off the AST change
  (done here via ADR 0009); Susan (Web) implements the `markdown-dom.ts` branch; Mary (TUI)
  implements the `markdown-ansi.ts` branch. The AST/parser change and its tests are Core's.

## Risks

- Held back from implementation this pass — see 2026-07-19 Notes entry. Primary risk is
  scope creep from "narrow allowlisted span" into a general HTML-passthrough surface, which
  the shared markdown module's own header comment calls out as the deliberate security
  property being protected (`src/markdown/index.ts`: "there is no HTML AST node type at
  all... a `<script>` tag in model output can never become markup in either client").

## Open Questions

- ~~Does this warrant a full ADR or just architect sign-off?~~ **Resolved (2026-07-19, Fable):
  full ADR — ADR 0009. It amends a documented core security invariant ("no HTML AST node type
  at all") that the module header self-classifies as contracts-tier, so a durable, citable
  decision record is warranted, not just a ticket note.

## Notes

### 2026-07-19 — implemented per ADR 0009, → verifying

Built exactly the ADR 0009 design, one implementer pass across all three ownership slices:

- `src/markdown/index.ts`: added the `coloredSpan` `InlineNode` variant, `COLORED_SPAN_OPEN`
  regex, frozen `NAMED_COLORS` set, and `validateColor` (exported for direct unit testing).
  Wired into `parseInline`'s `<` handling with the fail-closed algorithm from the ADR
  (opening-regex match → `validateColor` gate → first-`</span>` search → construct). Amended
  the file header to describe the one bounded exception and cite ADR 0009.
- `src/web/client/markdown-dom.ts`: added `case "coloredSpan"` to `renderInlineNode`, setting
  `span.style.color = node.color` via property assignment only (no string-built `style="…"`,
  no `innerHTML`).
- `src/tui/markdown-ansi.ts`: added the fixed `NAME_TO_SGR` map and a `case "coloredSpan"` in
  `inlineToLines` — named colors get their mapped SGR code from the existing 16-color
  allowlist, hex/unmapped names render plain with `codes` unchanged.

**User Story → proving test:**

- "operator reading a transcript... Web client... `style.color === 'red'`" →
  `src/web/client/markdown-dom.test.ts` — "a named-color span renders as a `<span>` with
  style.color set via property assignment".
- "...TUI... SGR 31 with trailing reset, row self-contained" →
  `src/tui/markdown-ansi.test.ts` — "a named color emits the mapped SGR code around the text,
  with a trailing reset".
- "...hex... TUI renders plain (no color SGR emitted)... Web `style.color === '#ff0000'`" →
  `src/tui/markdown-ansi.test.ts` — "a hex color renders as plain text — no color SGR code at
  all"; `src/web/client/markdown-dom.test.ts` — "a hex-color span sets style.color to the hex
  value".
- "security reviewer... every ADR 0009 adversarial input... no `coloredSpan` node produced" →
  `src/markdown/index.test.ts`, `describe("parseInline — coloredSpan (DH-0206/ADR 0009)")`,
  adversarial cases 1–9, 11a–11c — one test per numbered case in the ADR's required list (all
  11 numbered cases covered, 6 split into 6a/6b for the two quote-breakout variants).
- "valid span, mixed case/quote style/optional `;`... one `coloredSpan` node, lowercased
  normalized color" → `src/markdown/index.test.ts`, happy-path tests in the same describe
  block (case 10 in the ADR): named+`;`, named no `;`, 3-digit hex, 6-digit hex, mixed-case
  tag/attribute/color, single-quoted, plus a nested-formatting-in-children case.

Renderer-level adversarial coverage (ADR 0009's renderer-level bullet): both
`markdown-dom.test.ts` and `markdown-ansi.test.ts` include an "invalid span shape" case
(`url(javascript:alert(1))`) confirming no `<span>`/no color SGR is ever produced for a
grammar-rejected input, on top of the parser-level guarantee.

Gates: `bun test src/markdown/index.test.ts src/web/client/markdown-dom.test.ts
src/tui/markdown-ansi.test.ts --coverage` → 100% funcs/lines on all three changed files, 247
passing tests. `bun x biome check` on the six changed files → clean. Full-repo `bun test src`
and `bun run typecheck`/`bun run lint` were also run; failures observed there are all in files
outside this ticket's scope (`src/agent/tools/*`, `src/agent/workflow/*`, `src/cli/header.*`)
from other agents' concurrent uncommitted work on the shared branch, confirmed pre-existing by
stashing this ticket's changes and re-running — not touched or caused by DH-0206.

Judgment calls: kept the closing-tag search case-sensitive/literal (`</span>` exactly, matching
the ADR's regex-only spec for the opening tag) — a test originally assumed a mixed-case close
tag would still match and had to be corrected to reflect the actual (correct, ADR-compliant)
fail-closed behavior. `orange`/`purple` reuse the yellow/magenta SGR codes per the ADR's own
`NAME_TO_SGR` table (no new codes introduced).

### 2026-07-19 — architect sign-off (Fable): blessed, ADR 0009 written, → ready

Decision: **blessed the scoped design**, with the shape amended from a generic "HTML node" to a
semantic color node so the "no HTML AST node type" invariant is narrowed by exactly one bounded
surface rather than broken open. Wrote **ADR 0009** (`docs/adr/0009-markdown-colored-span-subset.md`)
as the authoritative spec. Key nail-downs beyond the prior held-note sketch:

- Node is `{ kind: "coloredSpan"; children; color }` — no tag name, no attribute string, no raw
  markup stored; only allowlist-validated children + a validated color. Not a general HTML node.
- Exact opening regex `COLORED_SPAN_OPEN` with two gates: (1) value char class excludes
  `; " ' ( ) < > { }` (kills `url(`/`expression(`/quote-breakout/tag-breakout), (2) authoritative
  `validateColor` allowlist (hex `#rgb`/`#rrggbb` OR the 12-name `NAMED_COLORS` set). Fail closed.
- Nesting: closes at first `</span>`, inner opening degrades to literal — deterministic, safe,
  not required to be pretty.
- Web: `element.style.color` property assignment only (browser re-validates); no string style
  attr, no innerHTML.
- TUI: fixed `NAME_TO_SGR` within the existing 16-color allowlist; hex/unmapped → plain text, no
  free-form ANSI, no 256/truecolor plumbing.
- Confirmed and extended the adversarial test list (11 parser cases + 2 renderer cases) — see
  ADR 0009's final section. These are ship-blocking.

Ownership: Core owns the AST/parser change + its tests (signed off here); Susan implements the
Web branch, Mary the TUI branch. Transitioned `refining → ready`.

### 2026-07-19 — held, not implemented this pass

Decision: leaving DH-0206 unimplemented, transitioning `draft -> refining` rather than
building it in this pass, alongside DH-0203/0204/0205 (which did ship).

Reasoning:

1. `src/markdown/index.ts`'s own file header states, as a documented design invariant: "Raw
   HTML is always literal text: there is no HTML AST node type at all. That absence is the
   core security property this ticket [DH-0056] exists for — a `<script>` tag in model
   output can never become markup in either client, because the AST has nothing that could
   render it as one." Introducing any HTML-tag-shaped AST node — even a narrowly allowlisted
   `<span style="color:...">` — is a change to that stated invariant, not a routine bugfix
   alongside the other three tickets.
2. The file's header also says grammar/AST changes to this module need architect sign-off,
   equating its governance to `src/contracts/` (CLAUDE.md §6.2's escalation trigger). The
   ticket's own Summary independently flags the same thing ("flag for architect review given
   this touches untrusted-content rendering") and its status was `draft`, not `ready` — unlike
   the other three, it was never green-lit for implementation.
3. The content this renders is explicitly untrusted (model output, tool output rendered in
   the transcript). Even a well-scoped allowlist (only `style`, only `color`, only named-color
   or `#hex` values, reject anything else) is a meaningfully different risk profile than the
   current zero-HTML-surface design, and a rushed implementation inside a batch of three
   unrelated bugfixes is the wrong context to get that scoping review right.

What a safe implementation would need before landing, if architect sign-off is obtained:
- A new `InlineNode` variant (e.g. `{ kind: "coloredSpan"; children: InlineNode[]; color: string }`)
  gated to *only* the exact opening-tag shape `<span style="color: <value>;?">`, matched by a
  strict regex, with the value validated against an allowlist pattern (named CSS color
  keywords, `#rgb`/`#rrggbb`) before the node is ever constructed — never a general
  attribute-string passthrough.
- No general `<...>` tag recognition of any kind; any other tag or malformed span stays
  literal text exactly as today (fails closed, not open).
- Web renderer sets `element.style.color` (property assignment, not string-built
  `style="..."` HTML) from the already-validated value; TUI renderer either ignores the color
  (renders plain text) or maps a small fixed set of allowlisted color names to existing SGR
  codes — no free-form ANSI sequence construction from model-controlled input.
- A dedicated adversarial test suite: attempted `url(...)`, `expression(...)`,
  `javascript:`, unescaped quotes/`>`/`<` inside the style value, nested/nested-looking spans,
  and unclosed spans must all degrade to literal text, never to styled markup.

Recommend: architect (Fable) review per CLAUDE.md §6.2 before any implementation attempt,
given the file's own governance note. DH-0203/0204/0205 shipped in this pass regardless of
this hold, per the task's explicit instruction not to let 0206 block the higher-confidence
wins.
