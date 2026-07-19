---
spile: ticket
id: DH-0206
type: feature
status: refining
owner: stefan
resolution:
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

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

- Held back from implementation this pass — see 2026-07-19 Notes entry. Primary risk is
  scope creep from "narrow allowlisted span" into a general HTML-passthrough surface, which
  the shared markdown module's own header comment calls out as the deliberate security
  property being protected (`src/markdown/index.ts`: "there is no HTML AST node type at
  all... a `<script>` tag in model output can never become markup in either client").

## Open Questions

- Does this warrant a full ADR (touches an invariant the shared markdown module's own docs
  treat as load-bearing) or just architect (Fable) sign-off on a scoped grammar addition,
  per CLAUDE.md §6.2 ("A change to `src/contracts/`-equivalent shared truth... grammar/AST
  changes need architect sign-off")? `src/markdown/index.ts`'s file header explicitly places
  itself in that governance tier.

## Notes

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
