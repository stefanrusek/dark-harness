---
spile: ticket
id: DH-0193
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0121, DH-0192]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0193: Wordmark needs more padding wherever it's plugged in next to the logo

## Summary

Owner review of DH-0121's delivered logo, 2026-07-19: the 'dh' wordmark reads too tight/cramped wherever it's placed alongside the logo mark (README hero, Web UI header, TUI banner -- wherever DH-0068/DH-0122/DH-0124's layouts combine them). Needs more padding/breathing room between the mark and the text, and between the combined lockup and surrounding chrome. Likely lands as part of the same pass as DH-0192 (logo redesign) since the two marks are being revisited together, but filed separately since padding is a layout/spacing fix distinct from the mark's own visual concept -- could in principle be fixed independently if the redesign takes a while. Route through Muriel (Design crew) first, same as DH-0121/DH-0192.

## Design resolution (Fable, 2026-07-19 — see DH-0192 for the full mark exploration)

This is the **lockup/spacing half** of DH-0192. The mark exploration lives there; this ticket
owns the *breathing room* around whatever mark wins, and the two land in one implementation
pass. The values below are silhouette-agnostic (they hold for any of DH-0192's three concepts);
the one caveat is that Concept 1's mark opens *toward* the wordmark, so the cup already creates
a little optical space — if Concept 1 wins, the mark↔wordmark gap can sit at the **lower** end
of the range below without reading cramped.

**The lockup, defined in mark-relative units** (so it holds at any render size):

- **Mark↔wordmark gap:** 0.4–0.6× the mark's width between the mark's right extent and the
  first glyph of "Dark". (Today the CSS `.brand::before` uses a single trailing space in
  `content: "◆ "`, which is why it reads cramped.) In the web header, replace the
  `content: "◆ "` space-hack with a real flex `gap` (≈ `var(--space-3)`, tuned to the above
  ratio); the mark and wordmark should be flex siblings, not a `::before` string.
- **Lockup↔chrome padding:** at least 1× the mark's width of clear space between the combined
  mark+wordmark lockup and any surrounding chrome (pane edges, connection pill, borders). Web
  `.brand` padding is bumped accordingly.
- **Vertical:** mark vertically centered to the wordmark's cap height (not baseline-aligned),
  in every surface.

## User Stories

### As a visitor/user seeing the `dh` lockup, I want the wordmark to have breathing room, not read cramped against the mark

- Given the web header (`.brand`), when it renders, then the mark and "Dark Harness" are flex
  siblings separated by a real `gap` of 0.4–0.6× the mark width (no `::before` space-hack), and
  the lockup has ≥1× mark-width of padding from surrounding chrome.
- Given the README hero lockup, when it renders, then there is ≥0.4× mark-width of space between
  the mark and the wordmark.
- Given the TUI/ASCII banner lockup, when it renders, then the diamond and `dh` are separated by
  at least one space cell (visually the ASCII analog of the ratio above).
- Given any of these surfaces, when the mark and wordmark render, then the mark is vertically
  centered to the wordmark's cap height.

## Functional Requirements

- Web: replace `.brand::before { content: "◆ " }` with a structural mark+wordmark lockup using
  flex `gap`; bump `.brand` padding to give ≥1× mark-width chrome clearance.
- README + TUI/ASCII: apply the mark↔wordmark spacing above.
- Values are mark-relative; final gap tunes to DH-0192's winning silhouette (Concept 1 → lower
  end of the range). Implement in the **same pass** as DH-0192.
- Fan-out: Web (Susan) for the header/CSS; Prompt (Iris) for README/ASCII; TUI (Mary) for the
  banner lockup.

## Assumptions

- Lands together with DH-0192; not worth a separate isolated pass unless the mark redesign
  stalls (in which case the README/TUI spacing fixes are independently shippable; only the web
  header lockup depends on the final mark).

## Risks

- Minimal — this is a low-taste-risk layout fix. Kept at `refining` only because the exact
  mark↔wordmark gap tunes to DH-0192's chosen silhouette; otherwise ready to build.

## Open Questions

## Notes

- 2026-07-19 (Fable): filled in as the shared lockup/padding half of DH-0192; status
  draft → refining. Specified spacing in mark-relative units so it survives the mark redesign.
