---
spile: ticket
id: DH-0219
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0121, DH-0192, DH-0193, DH-0198]
  supersedes: [DH-0192, DH-0193]
implementation:
  - repo: dark-harness
---

# DH-0219: New DH monogram logo (uppercase D+H, replaces diamond-evolution direction)

## Summary

Owner routed this to a separate Fable design session (2026-07-19), which produced a complete
handoff superseding DH-0192/0193's "evolve the diamond toward a blinder" direction entirely.
Final logo: a plain uppercase **D** and **H**, side by side, in the system wire style —
14-gauge round-cap strokes, green→cyan gradient, no ligature, no shared strokes, no accessory
marks. Canonical export: **transparent background** (owner decision, 2026-07-19 — chosen over
a dark-badge export for flexibility compositing onto different backgrounds).

**Geometry** (for regeneration): D stem x=46, bowl `M46 64 H82 A44 64 0 0 1 82 192 H46`; H
stems x=146/x=210, crossbar y=128; letter gap 20. The elliptical bowl (rx=44/ry=64) keeps D
and H at similar widths. Verified legible at a true 16px raster.

**Palette** (shared with the new CLI headers, DH-0220):

| Role | Hex | Use |
| --- | --- | --- |
| harness green | `#9ECE6A` | ok states, ✓, live dot |
| lead orange | `#E0AF68` | warnings, accents |
| wire gray | `#565F89` | frame lines, dim labels |
| signal cyan | `#7DCFFF` | URLs, interactive values |
| bone white | `#C0CAF5` | primary values |

**Usage: external surfaces only** — favicon/tray/tab (transparent export), README and web UI
masthead (badge treatment applied at usage site, not baked into the canonical file). The logo
never renders in the terminal — the CLI headers (DH-0220) are the terminal identity, entirely
separate art.

## User Stories

### As a visitor to the repo/web UI, I want the logo to read instantly as "DH", nothing else

- Given `docs/media/logo.svg` (replacing the current asset), when viewed at any size, then it
  reads as two distinct, conventional uppercase letterforms — D and H — with no ligature, no
  accessory marks, and nothing that could be misread as anything else (explicitly closing out
  the original "unintentionally suggestive" finding from DH-0121/DH-0192 by using a
  self-evidently literal letterform pair instead of an evolved abstract shape).

### As a user seeing the logo at very small sizes (favicon, tab icon), I want it to stay legible

- Given the logo rendered at a true 16×16 raster, when viewed, then both letterforms remain
  individually legible — proven by a real rendered screenshot at that exact size, not just
  visual inspection of the full-size SVG.

### As a user with color-vision differences or a monochrome context, I want the logo to still read correctly

- Given the logo rendered in monochrome (no gradient/color), when viewed, then it still reads
  clearly as "DH" — the letterforms carry the identity, not the color treatment.

## Functional Requirements

- Replace `docs/media/logo.svg` with the new DH monogram per the geometry above. Round-cap
  strokes, single gauge, green→cyan gradient (harness green → signal cyan), re-weightable per
  size (i.e. don't hardcode a stroke width that breaks at favicon scale — verify at both full
  size and 16px).
- **Transparent background** (owner decision) — no dark badge baked into the canonical file.
  Any badge/framing treatment (e.g. README masthead) is applied at the usage site via
  surrounding markup/CSS, not the SVG itself.
- Update every current consumer of the old asset: web favicon (`src/web/client/index.html`),
  web header/masthead, README hero, social preview reference — per DH-0121's original Web-owned
  fan-out (Susan).
- No logo-rendering code ships in the CLI — the terminal headers (DH-0220) are separate,
  unrelated ASCII/ANSI art, not a rendering of this SVG.
- Verify against DH-0198 (web header never actually renders the brand mark) — this ticket's
  landing is what unblocks DH-0198, since DH-0198 was waiting on the final mark form.

## Assumptions

- The color palette table above is shared with DH-0220 (CLI headers) — implement/reference a
  single source of truth for these five hex values if a natural shared location exists
  (e.g. `src/design-tokens.ts`), rather than duplicating the palette in two places.

## Risks

- Low — this is a straightforward asset replacement with precise geometry already specified;
  the main risk is skipping the true-16px legibility verification and shipping something that
  looks fine at full size but muddies at favicon scale.

## Open Questions

None remaining — all three of Fable's flagged open questions were resolved by the owner
(2026-07-19): full 12-line header banner (DH-0220), transparent-background canonical logo
export (this ticket), and restyling subsequent `dh:` log-line prefixes to match Header B
(DH-0220).

## Notes

Supersedes DH-0192 (logo redesign exploration) and DH-0193 (wordmark padding) — both closed
as superseded by this ticket and DH-0220. The original "Blinker"/diamond-evolution concept
from the first design session is abandoned entirely in favor of this literal-monogram
direction from the owner's second, separate Fable session.
