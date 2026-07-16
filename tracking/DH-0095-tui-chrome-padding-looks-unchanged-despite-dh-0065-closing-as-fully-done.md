---
spile: ticket
id: DH-0095
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0065]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0095: TUI chrome/padding looks unchanged despite DH-0065 closing as fully done

## Summary

Live testing (screenshot, 2026-07-16): the TUI's header/footer chrome and overall layout look visually identical to before DH-0065's polish pass -- no left/right padding around text (content butts flush against the terminal edge, no 1-character buffer), no visible change to the header/footer styling despite DH-0065's own status log claiming header/footer chrome was addressed. Either the fix didn't actually ship as claimed, or it shipped but is visually indistinguishable from before. Needs investigation against the real compiled binary (not just the closed ticket's own claims) to determine what's actually different and fix the remaining gap -- specifically add basic padding/margin around the transcript and chrome, which the owner explicitly called out as jarring in its absence.

## User Stories

### As an operator, I want the transcript and chrome to have basic breathing room, not text flush against the terminal edge

- Given the TUI renders any frame, when text is drawn, then there's at least a 1-character
  left/right margin around content — not glued to column 0 and the terminal's right edge.
- Given the header/footer chrome, when compared to the pre-DH-0065 screenshot baseline, then
  it's visibly, not just theoretically, different — actual styling an operator would notice.

## Functional Requirements

- Investigate against the real compiled binary (build fresh, run it, screenshot/capture —
  don't trust the closed ticket's own claims) to determine exactly what DH-0065 did and
  didn't change visually.
- Add left/right padding (minimum 1 char) around the transcript content and header/footer
  text in `src/tui/render.ts`.
- If DH-0065's header/footer styling genuinely isn't rendering (a real regression, not just
  a subtle style the owner didn't notice), root-cause and fix that too.

## Notes

> [!NOTE]
> Found 2026-07-16 via a live screenshot during owner testing — the owner was "a little
> disappointed with the polish pass," specifically citing the window outside the chat log
> looking identical to before, "even down to the jarring lack of a 1-char buffer." DH-0065
> closed itself as fully done; this ticket exists because that claim doesn't match what was
> actually observed running the real binary.
