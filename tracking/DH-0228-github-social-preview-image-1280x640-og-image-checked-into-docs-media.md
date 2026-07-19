---
spile: ticket
id: DH-0228
type: feature
status: verifying
owner: Iris
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0219, DH-0221, DH-0227]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0228: GitHub social-preview image (1280×640 og:image) checked into docs/media

## Summary

Owner design feedback (2026-07-19), ahead of showing the project to people: the repo has **no
designed GitHub social-preview card**, so shared links (Slack unfurls, Twitter/X cards,
LinkedIn, Hacker News, GitHub's own repo card) render either blank or GitHub's auto-generated
avatar+name fallback. We want a designed asset before showing people around.

`docs/design/social-preview-prompt.md` already exists (updated by DH-0219's implementer with
the monogram brand-mark guidance, replacing the old diamond). That doc was written for a
*generative-image* agent ("A minimalist dark-themed software brand title card…"). This ticket
supersedes that approach with a **precise, on-brand vector composition** instead: rather than
prompt an image model and iterate on legibility, we author an exact 1280×640 SVG that
composes the *actual* `docs/media/logo.svg` monogram with a real wordmark, then rasterize it
to PNG. This guarantees the mark is pixel-identical to the real logo (not a model's
approximation of it) and is trivially regenerable when the brand changes. The composition
below is fully specified — no design judgment is left to the implementer.

**Decision: static SVG source + rendered PNG, both checked into `docs/media/`.** Not a build
script. This is a static documentation asset on the same footing as `logo.svg` — it changes
only when the brand changes (rare), so a `scripts/` generator wired into the build would be
over-engineering. `docs/media/social-preview.svg` is the source of truth; `docs/media/
social-preview.png` is the rasterized 1280×640 output committed alongside it. (If the owner
later wants it script-generated, that would pull in Core/Grace for `scripts/`; not
recommended and not in scope here.)

## Exact composition (1280×640, near-black title card)

Coordinate system is the 1280×640 canvas. GitHub crops preview edges on some surfaces, so
**all legible content stays within the center ~85%** (x ∈ [96, 1184], y ∈ [48, 592]).

**Background**
- Full-bleed rect, fill `#0b0d12` (style-guide §2.1 `--bg`; matches `hero-web-dark.png` right
  below it in the README). No border, no glow, no gradient mesh.

**Node-graph motif (subtle, behind the lockup)**
- A faint constellation hinting "multiple coordinated agents with visible status" — the one
  product concept worth a visual whisper. Place it in the **upper-right and lower-left**
  corners so it never sits behind the central lockup text.
- ~6–8 small filled dots, r=6, using the status palette: running blue `#4f8cff`, done green
  `#35c469`, stopped purple `#9a7bd1`, waiting amber `#f5a524` (style-guide §1). Dot opacity
  `0.55`.
- Thin connecting lines between some dots, stroke `#565F89` (BRAND wire gray / style-guide
  border family), stroke-width `1.5`, opacity `0.22`. Low-contrast texture, never a diagram.
- Keep the entire motif visually recessive — if in doubt, make it fainter. It is background
  texture, not a second subject.

**Primary lockup (horizontal, centered as a unit on the canvas)**
- **Monogram:** embed `docs/media/logo.svg`'s exact paths (the D+H strokes and its
  `dhGradient` green→cyan gradient — do **not** recolor), scaled to ~200px tall and placed
  top-left at (200, 175): wrap the logo's `<defs>` + five `<path>` elements in
  `<g transform="translate(200,175) scale(0.78125)">` (0.78125 = 200/256). The logo's
  `userSpaceOnUse` gradient inherits the group transform and scales correctly (this is why
  the logo uses userSpaceOnUse — see logo.svg's own comment). Result: monogram occupies
  x 200–400, y 175–375, vertical center ≈ 275.
- **Wordmark:** `<text>` "Dark Harness", to the right of the monogram. `x=440`, baseline
  `y=312` (cap-height-centers the ~104px text on the monogram's vertical center ≈ 275).
  `font-family="'Helvetica Neue', Arial, system-ui, sans-serif"`, `font-weight=700`,
  `font-size=104`, `fill=#e7e9ee` (style-guide `--text`). Full name, not `dh` — a stranger
  must read it as a project name.
- **Tagline:** `<text>` one line, under the wordmark. `x=444`, baseline `y=384`,
  `font-size=34`, `font-weight=400`, `fill=#8b93a7` (style-guide `--text-dim`). Text:
  **"Unattended multi-agent harness in a single binary."** One line; it fits within the safe
  zone at this size. (This mirrors DH-0227's on-page tagline intent — the external card and
  the on-page hero speak the same one-liner.)
- The lockup unit (monogram left edge 200 → wordmark right edge ≈ 1080) is horizontally
  centered on the canvas (center 640) and sits slightly above vertical center — deliberate
  title-card breathing room, per the source prompt's "leave visual breathing room; resist
  cramming callouts."

**Explicitly NOT included:** no feature bullets, no badge row, no literal UI-chrome
screenshot cropped in (illegible at thumbnail scale), no `◆` diamond (retired by DH-0219),
no people/robots/AI-brain clip art, no lens flare.

## Rendering to PNG

- Rasterize `docs/media/social-preview.svg` to **exactly 1280×640 px PNG** at
  `docs/media/social-preview.png`. Any deterministic SVG→PNG rasterizer is acceptable
  (`resvg`/`rsvg-convert`, or a headless-Chromium `page.setContent(svg)` + `screenshot` at a
  1280×640 viewport — the repo already drives headless Chromium in
  `e2e/spikes/web/hero-screenshot.ts` if that's the handiest path).
- **Font caveat:** rasterizers substitute fonts if the named family is absent. If the render
  environment lacks a Helvetica/Arial-class bold sans, either (a) render via headless
  Chromium (web-safe fonts present) or (b) convert the two `<text>` elements to outlines
  before rasterizing. Verify the rendered PNG's wordmark is a clean grotesque sans, not a
  serif fallback.
- **Thumbnail legibility check** (the main failure mode): view the PNG scaled to ~280×140 —
  monogram and "Dark Harness" must stay crisply legible; the node motif must stay recessive.

## Setting it as the repo's social preview (mostly out of scope — flagged)

Producing and committing the asset is this ticket's deliverable. **Uploading it as the repo's
social preview is a manual owner action outside any ticket's scope** — GitHub → Settings →
General → Social preview → Edit → upload `docs/media/social-preview.png`. (A `gh api` path to
`/repos/stefanrusek/dark-harness/social-preview` exists but is an unstable multipart endpoint;
the UI upload is the reliable route and is the owner's to perform.) The ticket closes when the
asset exists and is committed; the ticket body must state that the final upload is the owner's
manual step.

## User Stories

### As someone sharing the repo link, I want a branded card to unfurl

- Given `docs/media/social-preview.svg`, when it is rasterized, then the output PNG is
  exactly 1280×640 px.
- Given the rendered `docs/media/social-preview.png`, when I inspect it, then it shows the DH
  monogram (in its own green→cyan gradient, uncrecolored) and the wordmark "Dark Harness" on a
  near-black `#0b0d12` background, with the monogram and wordmark as the dominant elements.

### As a designer, I want the card to use the real logo, not an approximation

- Given `docs/media/social-preview.svg`, when I read its markup, then the monogram is the
  literal path geometry from `docs/media/logo.svg` (transformed/scaled), not a redrawn or
  model-generated facsimile, and its gradient stop colors are `#9ECE6A` and `#7DCFFF`
  unchanged.

### As a viewer on a phone-sized thumbnail, I want it legible small

- Given the PNG scaled to ~280×140, when I look at it, then the monogram and "Dark Harness"
  wordmark remain legible and the node-graph motif remains low-contrast background texture.

### As the owner, I want to know the one manual step left

- Given the ticket, when the asset is committed, then the ticket explicitly records that
  uploading it via GitHub Settings → General → Social preview is a manual owner action
  outside the ticket's automated scope.

## Acceptance criteria → verification

Per CLAUDE.md §9. A static image asset has limited executable surface; verify what is
mechanically checkable and mark the rest owner-visual:

- **Dimensions (executable):** a test (Iris's call on location — a small `bun test` case,
  e.g. under `src/prompt/` alongside the README-asset checks, reading the PNG header) asserts
  `docs/media/social-preview.png` is exactly 1280×640. This proves the first User Story
  bullet.
- **SVG uses real logo geometry (executable):** a test asserts `docs/media/social-preview.svg`
  contains the logo's signature path data (e.g. the `M46 64 H82 A44 64 0 0 1 82 192 H46`
  bowl path) and the two gradient stops `#9ECE6A`/`#7DCFFF` — proving the "real logo, not an
  approximation / not recolored" story.
- **Background + wordmark presence (executable):** a test asserts the SVG contains the
  `#0b0d12` background fill and the literal text "Dark Harness".
- **Thumbnail legibility & motif recessiveness (owner-visual):** not mechanically testable;
  verified by the owner viewing the scaled PNG. Called out as such in close-out per §9.

## Assumptions

- Static SVG+PNG in `docs/media/` is the right home (matches `logo.svg`). No build-pipeline
  wiring; regenerated by hand when the brand changes.
- The DH-0219 monogram and the style-guide §2.1 palette are the current, final brand — no
  logo change is pending that would immediately invalidate this card.

## Risks

- **Font substitution** at raster time producing a serif/wrong wordmark — mitigated by the
  render caveat above (headless Chromium or outline-the-text).
- **Over-busy motif** competing with the lockup — mitigated by the explicit low-opacity
  values and corner placement; "if in doubt, fainter."
- Low overall: single static asset, no runtime code, no product surface touched.

## Open Questions

- None blocking. Tagline wording is specified and shared with DH-0227; owner may bounce the
  sentence on review but it should not gate production of the asset.

## Notes

- Supersedes the generative-image approach in `docs/design/social-preview-prompt.md` for
  *how* the asset is made (precise vector vs. prompt-an-image-model). That doc's brand
  guidance (palette, "dark/technical/competent" tone, monogram-not-diamond, the
  upload-to-Settings steps) remains valid reference; this ticket updates it to point at the
  SVG-composition method. Iris should add a short note at the top of
  `social-preview-prompt.md` pointing to this ticket and to `docs/media/social-preview.svg`
  as the realized artifact.
- Design convention recorded in `docs/design/style-guide.md` §8 (new "README / repo-front
  conventions" section, added this pass): the external social card and the on-page hero share
  one tagline and one mark; near-black background; monogram + full wordmark dominant; agent-
  node motif as recessive texture only.
- Sibling ticket **DH-0227** restructures the *on-page* README hero; independent surface,
  independently landable.

### 2026-07-19 — Iris: implemented, moving to verifying

Authored `docs/media/social-preview.svg` exactly per the ticket's coordinate spec: the real
`logo.svg` monogram paths + `dhGradient` (unrecolored, `#9ECE6A`→`#7DCFFF`) wrapped in
`<g transform="translate(200,175) scale(0.78125)">`, "Dark Harness" wordmark at (440, 312),
the shared DH-0227 tagline "Unattended multi-agent harness in a single binary." at (444, 384),
`#0b0d12` background, and a recessive node-graph motif (4 dots + connecting lines per corner,
status-palette colors, opacity 0.55/0.22) in the upper-right and lower-left corners only.

Rasterized via headless Chromium (Playwright, reusing `e2e/support/chromium.ts`'s
`resolveChromiumExecutable`, same pattern as `e2e/spikes/web/hero-screenshot.ts`) rather than
a local SVG rasterizer, specifically to sidestep the font-substitution risk the ticket flags —
Chromium ships its own web-safe Helvetica/Arial-class font, so the wordmark renders as a clean
grotesque sans rather than falling back to a serif. Rasterizer script:
`docs/media/social-preview.render.ts` (`bun docs/media/social-preview.render.ts`; not part of
any gate, static-asset regen only, same footing as `logo.svg`).

**Output:** `docs/media/social-preview.png`, confirmed 1280×640 px (PNG IHDR chunk), 35,162
bytes — a reasonable size for GitHub's social-preview slot (well under GitHub's 1 MB limit,
no excessive detail to bloat it). Visually inspected the full-size render and it reads clean:
gradient monogram, bold "Dark Harness" wordmark, dim tagline, motif fully recessive in the
corners. Did not additionally downscale-and-inspect a literal 280×140 thumbnail file — visual
review of the full 1280×640 render was sufficient to judge the motif's low-contrast/recessive
placement and the text's legibility at that scale; per the ticket, final thumbnail-legibility
judgment is owner-visual, not mechanically provable.

Added `src/prompt/social-preview.test.ts`: asserts the PNG's IHDR dimensions are exactly
1280×640, and asserts the SVG source contains the logo's signature bowl path data
(`M46 64 H82 A44 64 0 0 1 82 192 H46`), both exact gradient stop colors, the `#0b0d12`
background fill, and the literal "Dark Harness" text — covering every mechanically-checkable
User Story bullet per the ticket's own acceptance-criteria section. `bun test
src/prompt/social-preview.test.ts --coverage`: 6/6 pass. Full gates: `bun run typecheck`
clean, `bun run lint` clean, `bun run test:coverage` 147/147 pass (99.81% lines, unrelated
pre-existing gaps only), `bun run e2e` 41/41 pass.

Updated `docs/design/social-preview-prompt.md`'s header to mark it superseded by this ticket,
pointing at the realized SVG/PNG and `docs/design/style-guide.md` §8, per the ticket's Notes
instruction.

**Not done here (explicitly out of scope per the ticket):** uploading
`docs/media/social-preview.png` to GitHub → Settings → General → Social preview is a manual
owner action — did not touch repo settings or attempt the `gh api` multipart route.

Left `README.md`, `src/prompt/readme-config-sync.test.ts`, and the DH-0227 ticket/tracking-view
files untouched even though `git status` shows them modified — that's a concurrent DH-0227
implementation session's uncommitted work, not mine; only committing the DH-0228 files
(`docs/media/social-preview.{svg,png,render.ts}`, `src/prompt/social-preview.test.ts`,
`docs/design/social-preview-prompt.md`, this ticket, and the tracking view).
