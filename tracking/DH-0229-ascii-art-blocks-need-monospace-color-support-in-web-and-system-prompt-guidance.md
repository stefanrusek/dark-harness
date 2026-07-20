---
spile: ticket
id: DH-0229
type: feature
status: verifying
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

# DH-0229: ASCII art blocks need monospace + color support in web and system prompt guidance

## Summary

ASCII art (balloon, header glyphs, diagrams) rendered with colored HTML spans needs proper styling in web UI. Solution: wrap in <pre style="font-family: monospace; white-space: pre;"> to preserve monospace layout while allowing inline color spans to render. TUI already handles this correctly (no changes needed, just ignore the pre/span tags). System prompt needs guidance clause so agents know to use this pattern for any ASCII art output.

## User Stories

### As an agent producing ASCII art, I want correct guidance for how to color it

- Given I want to render colored ASCII art, when I read the system prompt, then it tells me
  the one construct that actually renders color (`<span style="color: ...">`, per ADR 0009 /
  DH-0206) and does not point me at a construct that silently fails.
- Given I wrap art in a `<pre style="...">` tag as the ticket's original summary suggested,
  when that output is rendered, then it does **not** become a real monospace block in either
  client — it shows as the literal `<pre ...>` text, because the renderer has no HTML `pre`
  node at all (only the one allowlisted `coloredSpan` inline node exists). The system prompt
  must not advise a pattern that doesn't work.

## Functional Requirements

1. System prompt documents that colored spans may wrap multi-line text directly (newlines
   inside/between spans render as real line breaks in both clients), so ASCII art can be built
   from colored spans without any wrapper tag.
2. System prompt explicitly tells agents **not** to use a literal `<pre>` tag for this — it is
   not one of the recognized constructs and renders as literal text.
3. System prompt gives agents the actual tradeoff: colored spans in a paragraph (approximate
   alignment, real color) vs. a plain fenced code block (exact monospace alignment, no color)
   — pick one per block, since fenced-code-block contents are never run through the inline
   parser and so never pick up colored spans.

## Assumptions

- No `src/markdown/`, `src/web/client/`, or `src/tui/` code change is required. Confirmed by
  reading `src/markdown/index.ts` (grep for `<pre`/`"pre"`: no match — there is no HTML `pre`
  node or any general HTML node type, only the single allowlisted `coloredSpan` inline node
  from ADR 0009/DH-0206) and `src/web/client/markdown-dom.ts` (fenced code blocks render via
  `code.textContent = block.text` — literal, never inline-parsed, so a fenced block can never
  contain a live colored span either). A raw `<pre style="...">` tag in agent output is
  therefore *not* interpreted as HTML by either client — it appears as the literal characters
  `<pre style="...">`, which is a regression from what the ticket's original summary (and the
  live-session prompt edit in commit `d956ad8`) assumed. This ticket's actual fix is
  prompt-only: correct the guidance to describe what the renderers actually support, not add
  new rendering behavior.
- TUI needs no changes: it renders `coloredSpan` via direct ANSI SGR codes regardless of
  surrounding block type (`src/tui/markdown-ansi.ts`), so multi-line colored spans already
  work there with no wrapper tag of any kind.

## Risks

- If exact-column ASCII art with color together turns out to matter enough to be worth real
  engineering investment, that would be a new grammar/rendering feature (a real `pre`+color
  block type) requiring an ADR amendment (governance-equivalent to `src/contracts/`, per ADR
  0009's own precedent) and cross-domain work (`src/markdown/`, `src/tui/`, `src/web/`) — out
  of scope for this ticket and not build here. Flagged as a possible follow-up, not filed
  speculatively (no real incident/ask behind it yet).

## Open Questions

- None remaining for this ticket's actual scope (prompt-only). The exact-alignment-plus-color
  combination above is a follow-up idea, not an open question blocking this ticket.

## Notes

### 2026-07-19 — Iris: scope correction during DH-0233/DH-0234 combined pass

Filled in this ticket's TODO stubs while implementing DH-0233/DH-0234 in the same file
(`src/prompt/system-prompt.ts`) to avoid conflicting concurrent edits. Read the live-session
edit in commit `d956ad8` first as instructed, then verified against the actual renderer code
in `src/markdown/index.ts` and `src/web/client/markdown-dom.ts` — the `<pre>`-tag pattern that
commit added does not work (no HTML `pre` node exists in the shared Markdown AST; raw HTML
outside the one allowlisted colored-span shape is always literal text). Replaced that guidance
in the system prompt with a working pattern (multi-line colored spans, no wrapper tag) plus an
explicit "don't do this" note about `<pre>`. No `src/web/` or `src/tui/` code change was made
or needed — see Assumptions above for why. Moving to `verifying`.
