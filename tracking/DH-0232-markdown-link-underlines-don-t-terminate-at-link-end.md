---
spile: ticket
id: DH-0232
type: bug
status: verifying
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

### 2026-07-19 — Verification: bug already fixed by DH-0065, not reproducible on current main

Read `src/tui/markdown-ansi.ts` and `src/web/client/markdown-dom.ts` in full and reproduced the exact scenarios in the ticket (including the four-link list example and a link glued directly to trailing text with no space, per FR #4) against current `main`. Neither renderer leaks the link's underline/blue styling into following text.

- **TUI:** `serializeRow` (added in commit `fe5c6ef`, "TUI: fix inline Markdown style bleed in serializeRow (DH-0065)") already emits an explicit `RESET` whenever a segment transitions from a styled segment to one with different/no codes — this is a general fix, not link-specific, and it already covers the `link` case's own trailing `" (url)"` segment (which carries plain/unstyled codes) as well as whatever inline node follows the link. `fe5c6ef` landed before this ticket was filed, so the "likely root cause" in this ticket's diagnosis (link case missing its own SGR-24 reset) describes a bug that predates DH-0065 and was already fixed generically by it. Direct repro: `renderMarkdownRows(parseMarkdown("[link](https://example.com)trailing"), 80)` produces `"[4;34mlink[0m (https://example.com)trailing[0m"` — reset immediately after "link", no escape codes before "trailing". No production code change was needed.
- **Web:** confirmed no real bug, as the ticket's own Open Questions flagged as the likely outcome. `renderInlineNode`'s `link` case creates a real `<a>` element and appends the link's children as descendants; any text node that follows in the parent (e.g. from a sibling `text` inline node) is appended as the anchor's *sibling*, not its descendant, so no CSS applied to the anchor (underline via default `<a>` styling or `styles.css`) can cascade onto it — DOM/CSS scoping has no ANSI-style "persistent terminal state" failure mode to begin with.
- Added regression tests pinning the "link immediately followed by other text, no space" case (FR #4) to both `src/tui/markdown-ansi.test.ts` and `src/web/client/markdown-dom.test.ts` so this stays covered going forward, even though no source change was required.
- Gates: `bun run typecheck` and `bun run lint` clean. `bun test src/tui/markdown-ansi.test.ts src/web/client/markdown-dom.test.ts` — 131/131 pass, including the two new DH-0232 tests. Full `bun run test:coverage` shows one unrelated pre-existing failure in `src/web/client/app.test.ts` (queued-turn cancel button) caused by concurrent uncommitted work from other agents on DH-0230/DH-0231 in `src/tui/` (`app.ts`, `mouse.ts`, `Composer.tsx`) sharing this checkout — confirmed unrelated by stashing only this ticket's two changed files and re-running, which reproduces the same failure with or without this ticket's changes. Coverage itself is 100%. `bun run e2e` likewise has one unrelated PTY-boot timeout/tmux failure, same root cause (shared TUI files mid-edit by concurrent agents), not touching `markdown-ansi.ts` or `markdown-dom.ts`.
