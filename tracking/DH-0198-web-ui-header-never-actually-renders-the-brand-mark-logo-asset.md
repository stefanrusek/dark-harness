---
spile: ticket
id: DH-0198
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0192]
  relates_to: [DH-0193]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0198: Web UI header never actually renders the brand mark/logo asset

## Summary

Owner observation (2026-07-19), while reviewing logo redesign concepts: docs/media/logo.svg has never appeared in the actual dh web app -- confirmed by grep, zero references to logo.svg anywhere in src/web/. The web header currently only shows the .brand::before CSS pseudo-element (a bare '◆ ' text glyph, styles.css) plus the 'Dark Harness' text, never the real SVG mark. This means the owner had never actually seen docs/media/logo.svg rendered until it was shown out-of-band as flat markup during a design review -- it's effectively a dead asset outside the README. Web domain (Susan). Scope: render the actual brand mark (final form pending DH-0192's resolution) in the web app's header/chrome, not just the bare glyph pseudo-element. Depends on DH-0192 landing first since the final mark geometry isn't settled yet.

## Design resolution input (Fable, 2026-07-19 — DH-0192 round 2 has now settled the mark form)

DH-0192 resolved the mark form, and it changes what "render the real brand mark" means here:

- **The primary web-header mark is the `◆` diamond, kept a plain/abstract silhouette, colored in
  foreground ink (`currentColor`/`--fg`), not amber.** The owner rejected evolving the diamond's
  shape and confirmed the mark should be dark, not amber (the blinder reading needs a dark mark).
- **`docs/media/logo.svg` (the blue-brackets + `dh` + green-dot badge) is *not* the header's
  mark.** The owner is fine with `logo.svg` as a README/social badge asset; it is intentionally
  a *different* brand expression from the header diamond (see DH-0192's "two coexisting brand
  expressions" note). So this ticket is **not** "put `logo.svg` in the header" — that would put
  the wrong asset there.

Because the resolved mark is a plain diamond, a properly-colored `◆` glyph is arguably already an
adequate mark — which softens this ticket's original premise ("the SVG never renders" is only a
bug if the header actually needs a vector asset). The real, concrete defects that remain and are
worth fixing:

1. The header mark is painted **amber** (`.brand::before { color: var(--accent) }`) — it should
   be foreground ink per DH-0192. (This is the same fix DH-0192 FR-A lists; DH-0198 and DH-0192
   should not both change it — coordinate so it lands once, in the DH-0192/DH-0193 pass.)
2. The header mark is a `::before` string glued to the wordmark, not a structural element —
   which is exactly what DH-0193 replaces with a real flex lockup.

**Open decision for the owner / Susan (the one genuinely-undecided thing here):** given the mark
is now a plain ink diamond, is a crisp inline `<img>`/inline-SVG diamond in the header worth it
over the CSS `◆` glyph? A glyph is simplest and, once ink-colored and properly spaced, may fully
satisfy the mark's job; an inline SVG buys sharper geometry and exact lockup control but adds an
asset to maintain. This is a Web-domain taste/effort call, not an architectural one — hence left
to the owner/Susan rather than decided here.

## User Stories

### As a user of the web app, I want the header to show the brand mark correctly, not a mismatched amber glyph

- Given the web header, when it renders, then the `◆` mark is foreground ink (`currentColor`/
  `--fg`), matching the "Dark Harness" wordmark — not amber `var(--accent)`. (Coordinate with
  DH-0192 so this color fix lands once.)
- Given the web header, when it renders, then the mark is a structural element in a real flex
  lockup with the wordmark (per DH-0193), not a `::before` content string.

### As the owner, I want a decision on whether the header mark is a glyph or an inline SVG

- Given DH-0192's resolved plain-diamond mark, when Susan implements the header, then the choice
  between the CSS `◆` glyph and an inline SVG diamond is made deliberately (see the open decision
  above) and recorded in this ticket's Notes.

## Functional Requirements

- Fix the header mark color to foreground ink (coordinate with DH-0192 FR-A so it changes once).
- Make the header mark a structural flex-lockup element with the wordmark (shared with DH-0193).
- Do **not** render `docs/media/logo.svg` in the header — it's the wrong (bracket-badge) asset;
  the header's mark is the `◆` diamond.
- Decide glyph-vs-inline-SVG for the header diamond and record the decision.

## Assumptions

- Lands in/after the DH-0192 + DH-0193 pass (depends_on DH-0192).
- The header's mark is the `◆` diamond, not the `logo.svg` badge (per DH-0192 round 2).

## Risks

- Low. Main risk is DH-0192/DH-0193/DH-0198 each independently touching `.brand`'s color/spacing
  — must be coordinated into one pass so they don't conflict (directory-ownership: all Web/Susan,
  so one implementer takes all three).

## Open Questions

- Glyph vs. inline-SVG for the header diamond (see design resolution) — Web/Susan + owner call.

## Notes

- 2026-07-19 (Fable): filled in the TODO stubs with DH-0192 round 2's resolved mark form. Key
  correction to the original premise: the header's mark is the `◆` diamond (ink), **not**
  `docs/media/logo.svg` (which the owner is fine with as a separate badge asset); so this ticket
  is not "render logo.svg in the header." Left at `ready` (owner-owned); flagged the one genuine
  open decision (glyph vs inline SVG). All three of DH-0192/0193/0198 touch `.brand` and must be
  implemented as one coordinated Web pass.
