---
spile: ticket
id: DH-0025
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0056]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0025: TUI wide-character/resize/redraw rendering bugs

## Summary

The ANSI-injection/terminal-hijack story originally in this ticket is **superseded by
DH-0056** (render agent output as Markdown, with each client controlling its own safe
escape/HTML output) — see that ticket. What remains here are unrelated technical rendering
bugs: text wrapping/width math uses JS string length (UTF-16 code units), not visual/
grapheme width, so wide CJK characters, emoji, and combining marks misalign the frame and
can overflow declared column widths; the output-trimming logic can split a multi-code-unit
character at a trim boundary, producing a corrupted lone surrogate; resize events redraw the
full frame with no debouncing (flicker on rapid resize); and the once-per-second tick redraw
always does a full clear-and-rewrite rather than a diff, which is wasteful and can flicker
over high-latency SSH.

## User Stories

### As an operator viewing output containing wide characters, I want text wrapping and padding to account for real visual width, not UTF-16 code-unit count

- Given transcript text containing CJK characters, emoji, or combining marks, when it's
  wrapped/padded, then column alignment reflects actual terminal display width.
- Given a trim boundary falls inside a multi-code-unit character, when trimming, then the
  character is kept or dropped whole, never split into a corrupted lone surrogate.

### As an operator on a slow/high-latency connection, I want redraws to be efficient and not flicker

- Given a terminal resize, when multiple resize events fire in quick succession, then redraws
  are debounced rather than firing on every event.
- Given the once-per-second tick redraw, when nothing visible has changed, then it doesn't
  do a full clear-and-rewrite (diff-based redraw, or skip entirely when unchanged).

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #8 (wide-character width, including the surrogate-
> split trim bug), #9 (resize debounce), #10 (narrow-terminal handling — verified reasonably
> graceful already, no fix needed, not tracked further), and #36 (full-frame redraw every
> tick, not diff-based). Finding #7 (ANSI injection) — the original reason this ticket was
> flagged for owner input — moved to **DH-0056** entirely; this ticket needed no further
> input once trimmed and is ready to implement directly.

> [!NOTE]
> **2026-07-16 — verification pass.** Re-checked a prior blocked attempt's claim that this
> was already implemented on this branch, rather than trusting it outright. Confirmed true:
> commit `9d04fe4` adds `src/tui/width.ts` (codepoint/East-Asian-width-aware measurement,
> proven by `src/tui/width.test.ts`) and commit `99a4c58` wires it in — `sliceCodePoints`
> for surrogate-safe trimming in `trimTranscript` (proven by `src/tui/state.test.ts`), a
> 50ms resize debounce, and a skip-unchanged-frame tick redraw in `src/tui/app.ts` (both
> proven by `src/tui/app.test.ts`). Confirmed `width.ts` is genuinely wired in, not dead
> code — imported by `state.ts`, `render.ts`, and `markdown-ansi.ts`. Gates: `typecheck`
> passes; `lint` has only pre-existing failures under `.claude/skills/forked-subagent/`,
> none in `src/tui/`; `test:coverage` is 1959 pass / 0 fail with `src/tui/*` at 100% except
> one pre-existing, unrelated gap (`app.ts:190`, from DH-0093, predates this ticket);
> `e2e` is 17 pass / 18 fail, but every failure is the separately-tracked DH-0112 bug
> (`e2e/support/mock-provider.ts` not updated for DH-0044's mandatory streaming, causing
> hangs/wrong-exit-codes across bedrock/exit-codes/http-sse/tui/web tests generally) — no
> e2e test targets wide-char/resize/redraw behavior, so this ticket's criteria are
> unaffected. No code changes were needed; working tree was already clean. Moving to
> `verifying`.
