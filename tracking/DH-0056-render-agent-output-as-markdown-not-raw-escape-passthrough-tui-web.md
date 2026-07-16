---
spile: ticket
id: DH-0056
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0025]
  supersedes: [DH-0025]
implementation:
  - repo: dark-harness
---

# DH-0056: Render agent output as Markdown, not raw escape passthrough (TUI+Web)

## Summary

Supersedes DH-0025's original ANSI-sanitization story. Instead of trying to allowlist/strip a stream of untrusted raw escape bytes, treat agent output as Markdown: the system prompt instructs models that all text output is Markdown, and each client owns rendering it -- TUI converts Markdown to ANSI using only a small, client-controlled set of safe SGR codes (color/bold/etc, never OSC/cursor/DA-DSR sequences), Web converts Markdown to sanitized HTML. Since neither renderer ever passes model-authored escape bytes through verbatim, the entire class of terminal-hijack/clipboard-injection/input-injection attacks described in DH-0025 becomes structurally impossible rather than defended-against by a blocklist. Real UX upgrade too (actual formatted output) alongside the security fix.

## User Stories

### As an operator, I want agent output rendered in my terminal/browser to never be able to hijack terminal state, elicit unwanted terminal responses, or write to my clipboard

- Given the system prompt instructs the model that all text output is Markdown, when the TUI
  renders a turn, then it parses that Markdown itself and emits ANSI only from a small,
  client-controlled allowlist (color/bold/italic/code-span/list/heading styling) — never
  passing any byte of the model's own raw text through as a literal escape sequence.
- Given the same for Web, when a turn renders, then Markdown is converted to sanitized HTML
  (escaping raw HTML in the source rather than interpreting it) and inserted safely — no
  `innerHTML` on unsanitized content, preserving the existing "no XSS sink" property
  (confirmed clean today via `textContent`/`createTextNode`, per the TUI/Web security sweep).
- Given a model doesn't comply with the Markdown-output instruction and emits raw control
  bytes anyway, when either client renders it, then those bytes are still neutralized as a
  defensive fallback (strip C0 controls / ESC sequences from the raw text before Markdown
  parsing even begins) — the instruction is the primary defense, not the only one.

### As an operator, I want agent output to actually look nice, not just be safe

- Given a response containing headings, bold/italic text, inline code, code blocks, or
  lists, when rendered, then each client shows real visual formatting appropriate to its
  medium (ANSI styling for TUI, real HTML elements for Web) instead of raw Markdown syntax
  characters.

## Functional Requirements

- Given any Markdown construct the parser doesn't recognize, when rendering, then it degrades
  gracefully to plain text rather than erroring or corrupting the frame.
- Given the DA/DSR terminal-response-eliciting sequences DH-0025 specifically flagged (a
  terminal query whose reply gets written back into the app's own stdin as if it were a
  keystroke), when the defensive fallback strips raw escapes, then these are explicitly
  covered, not just generic "control characters."

## Assumptions

- A full CommonMark implementation isn't necessary — a pragmatic subset (headings, bold,
  italic, inline code, fenced code blocks, lists, links) covers what models actually produce
  and what HANDOFF.md's tool-output conventions need.
- TUI and Web can use different underlying implementations (ANSI vs. HTML output) as long as
  both parse the same Markdown subset consistently — no shared rendering code is assumed,
  though a shared Markdown *parser* (producing an intermediate AST each client renders
  differently) is worth considering if it doesn't overcomplicate things.

## Risks

- This changes what operators currently see (raw text) to formatted output — worth a quick
  visual sanity check across both clients before considering this fully done, not just gate-
  passing tests.

## Open Questions

- Exact safe-SGR allowlist for TUI (which colors/styles are "safe" — practically all standard
  SGR color/bold/italic/underline codes are inert from a security standpoint; the danger is
  specifically OSC/DCS/cursor-movement/DA-DSR sequences, not color).

## Notes

> [!NOTE]
> Raised directly by the owner (2026-07-15) as the proposed fix during Bucket B triage
> discussion of DH-0025's ANSI-injection story. Supersedes that story entirely; DH-0025 itself
> is trimmed to keep only its unrelated wide-character/resize/redraw technical bugs, which
> have nothing to do with Markdown rendering and can proceed independently.

