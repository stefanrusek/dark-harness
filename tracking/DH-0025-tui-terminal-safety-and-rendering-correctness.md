---
spile: ticket
id: DH-0025
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0025: TUI writes untrusted agent output straight to the terminal with no ANSI sanitization, and has wide-character/resize rendering bugs

## Summary

`src/tui/render.ts` passes agent transcript text (which can include arbitrary bytes from Bash/Read
of untrusted repo content, or content an LLM was tricked into emitting) directly into the composed
ANSI frame with no stripping of control characters or escape sequences — a malicious/compromised
agent could emit terminal title-bar hijacks, cursor-repositioning escapes, or terminal-response-
eliciting sequences (DA/DSR queries whose replies the terminal writes back into stdin, which the
app would then interpret as keystrokes) to corrupt the display or worse, in vulnerable terminal
emulators. Separately: text wrapping/width math uses JS string length (UTF-16 code units), not
visual/grapheme width, so wide CJK characters, emoji, and combining marks misalign the frame and
can overflow declared column widths; the output-trimming logic can split a multi-code-unit
character at a trim boundary, producing a corrupted lone surrogate; resize events redraw the full
frame with no debouncing (flicker on rapid resize); and the once-per-second tick redraw always
does a full clear-and-rewrite rather than a diff, which is wasteful and can flicker over
high-latency SSH.

## User Stories

### As an operator, I want agent output rendered in my terminal to never be able to hijack terminal state or elicit unwanted terminal responses

- Given agent output containing raw ANSI/control-sequence bytes, when it's rendered, then C0
  control characters and ESC sequences are stripped/escaped before being written to the terminal.

### As an operator viewing output containing wide characters, I want text wrapping and padding to account for real visual width, not UTF-16 code-unit count

- Given transcript text containing CJK characters, emoji, or combining marks, when it's wrapped/
  padded, then column alignment reflects actual terminal display width.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #7 (ANSI injection — flagged as a real security-adjacent
> gap), #8 (wide-character width, including a surrogate-split trim bug), #9 (resize debounce), #10
> (narrow-terminal handling — verified reasonably graceful, no fix needed), #36 (full-frame redraw
> every tick, not diff-based).
