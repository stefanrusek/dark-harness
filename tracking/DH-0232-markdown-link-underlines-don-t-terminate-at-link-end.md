---
spile: ticket
id: DH-0232
type: bug
status: open
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0056]
  relates_to: [DH-0056, DH-0108, DH-0109]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0232: Markdown link underlines don't terminate at link end (TUI + Web rendering bug)

## Summary

When rendering Markdown inline links (e.g., `[link text](url)`) in both the TUI and Web clients, the underline styling does not terminate at the end of the link text. Instead, the underline continues through trailing text that follows the link, incorrectly styling content outside the link. In the TUI, this is an ANSI SGR escape sequence issue; in the Web, it may be an HTML/CSS cascading issue.

## User Stories

### As an operator reading a transcript, I want link underlines to stop at the link end

- Given agent output containing a Markdown link like `[Dark Harness](https://github.com/example/dark-harness)`, when rendered in the TUI, then only the link text "Dark Harness" is underlined; any text immediately after the closing parenthesis is not underlined.
- Given the same link in the Web UI, then only the `<a>` element's text is styled as underlined; surrounding text has no underline.

## Functional Requirements

1. **TUI fix:** In `src/tui/markdown-ansi.ts`, fix the ANSI SGR escape sequence handling in the `link` case of `inlineToLines` to emit a proper underline reset code (SGR 24) immediately after link text
2. **Web fix:** Verify `src/web/client/markdown-dom.ts` properly closes the `<a>` tag without cascading underline styling into subsequent siblings
3. Ensure both renderers properly track where inline styling ends
4. Add test cases in both `src/tui/markdown-ansi.test.ts` and `src/web/client/markdown-dom.test.ts` covering links followed immediately by other text (no space between)

## Assumptions

- Root cause is likely a missing or incorrectly-positioned SGR reset code in the TUI renderer
- Web renderer may have a similar issue if the `<a>` tag isn't properly closed

## Risks

- None; this is a rendering fix with no logic changes

## Open Questions

- Is the Web renderer also affected, or only the TUI?
- Should there be a trailing space after links to provide visual separation, or is the styling fix sufficient?

## Notes

### 2026-07-19 — Manual testing observation

During comprehensive Markdown rendering test, observed that inline links rendered with underlines that bled into surrounding text.

**Example from test output:**
```
- [Dark Harness Repository](https://github.com/example/dark-harness)
- [PLAYBOOK.md](./PLAYBOOK.md)
- [docs/adr/0001-single-binary-modes.md](./docs/adr/0001-single-binary-modes.md)
- Email: [contact@example.com](mailto:contact@example.com)
```

The underlines on these links did not terminate properly and extended into text following the link URLs.

**Likely root cause:** In `src/tui/markdown-ansi.ts`, the `inlineToLines` function's handling of the `link` inline node type does not emit the SGR underline reset code (`\x1b[24m` or `\x1b[0m`) immediately after the link text. The underline styling state persists through subsequent inline nodes until the next explicit reset or style change.

Related: DH-0109 implemented full Markdown support including links; this is a rendering polish issue.
