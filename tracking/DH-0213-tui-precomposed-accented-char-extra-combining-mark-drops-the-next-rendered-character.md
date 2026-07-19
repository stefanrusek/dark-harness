---
spile: ticket
id: DH-0213
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0025, DH-0212]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0213: TUI: precomposed accented char + extra combining mark drops the next rendered character

## Summary

Isolated from the DH-0212 triage of DH-0060's wide-char spike (e2e/spikes/tui/spike-wide-char.ts). A string containing a precomposed accented character immediately followed by an extra Unicode combining mark (e.g. 'café' + U+0301, i.e. 'café́', two accents stacked on the same e) reliably causes the TUI to drop the very next character it renders after that cluster -- confirmed via minimal repro: 'café done.' renders the full period, but 'café́ done.' renders as 'café́ done' with the trailing period silently gone. Plain single combining marks, CJK, and emoji alone do NOT reproduce it -- isolated specifically to a base char + trailing combining mark forming a 2-codepoint cluster at the same visual column. src/tui/width.ts's own charWidth/stringWidth math computes this correctly (both give width 0 for the combining codepoint), so the miscount happens somewhere downstream in the Ink/Yoga render path (src/tui/ink/*), not in the shared width module. Needs someone to trace Ink's own internal text measurement (likely its string-width dependency) against src/tui/width.ts's model for this exact class of grapheme cluster and reconcile them.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
