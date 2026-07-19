---
spile: ticket
id: DH-0193
type: bug
status: ready
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
owns the *breathing room* around the mark, and the two land in one implementation pass. DH-0192's
silhouette resolution (round 2) is the plain `◆` diamond, so the values below hold as plain
mark-relative spacing — no silhouette-specific caveat applies anymore.

Note the DH-0192 color resolution reinforces this lockup rather than changing its spacing: the
mark now takes the **same foreground/ink color as the wordmark** (not amber), so mark + words
read as one unit — which is exactly what a tight, well-spaced lockup wants. Spacing values are
unaffected by the color change.

**The lockup, defined in mark-relative units** (so it holds at any render size):

- **Mark↔wordmark gap:** 0.4–0.6× the mark's width between the mark's right extent and the
  first glyph of "Dark" (use the mid-range ~0.5×; the plain diamond has no optical cup to lean
  on, so don't crowd it to the low end). (Today the CSS `.brand::before` uses a single trailing
  space in `content: "◆ "`, which is why it reads cramped.) In the web header, replace the
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
- Values are mark-relative; use the mid-range gap (~0.5× mark width) for the plain diamond.
  Implement in the **same pass** as DH-0192.
- Fan-out: Web (Susan) for the header/CSS; Prompt (Iris) for README/ASCII; TUI (Mary) for the
  banner lockup.

## Assumptions

- Lands together with DH-0192; not worth a separate isolated pass unless the mark redesign
  stalls (in which case the README/TUI spacing fixes are independently shippable; only the web
  header lockup depends on the final mark). Since DH-0192 round 2 leaves the mark a plain
  diamond, that risk is now low.

## Risks

- Minimal — low-taste-risk layout fix.

## Open Questions

## Notes

- 2026-07-19 (Fable): filled in as the shared lockup/padding half of DH-0192; status
  draft → refining. Specified spacing in mark-relative units so it survives the mark redesign.
- 2026-07-19 (Fable, round 2): DH-0192's silhouette resolved to the plain diamond and its color
  to foreground/ink (matching the wordmark), which removes the Concept-1 "cup gives optical
  space" caveat (use the mid-range gap) and reinforces the one-unit lockup. No spacing values
  changed. Status refining → ready.
