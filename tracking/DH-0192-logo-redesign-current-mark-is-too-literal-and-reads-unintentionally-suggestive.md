---
spile: ticket
id: DH-0192
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0121]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0192: Logo redesign: current mark is too literal and reads unintentionally suggestive

## Summary

Owner review of DH-0121's delivered logo (docs/media/logo.svg / ASCII banner in src/prompt/banner.ts), 2026-07-19: the current mark is too literal, and unfortunately reads as resembling genitals -- not the intended brand impression. Needs a real redesign pass, not a tweak. Route through Muriel (Design crew) first per CLAUDE.md's design-crew process (owns visual identity, CLAUDE.md section 7) to propose a new concept, then implementation to whichever domain(s) consume the result (Prompt for the ASCII banner text, Web for the SVG asset, TUI for ASCII rendering) -- same fan-out DH-0121 used. Both the SVG (docs/media/logo.svg) and ASCII-art (src/prompt/banner.ts's DH_ASCII_LOGO/DH_ASCII_LOGO_COMPACT) versions need to be revisited together since they're meant to share one visual identity.

**Owner design lead (2026-07-19):** doesn't dislike the ◆ black-diamond mark itself, and has
a concrete direction worth exploring before starting from zero — placed next to the words
"Dark Harness," the diamond reads like a **horse blinder** (the leather flap on a harness
that blocks peripheral vision), which fits the product name thematically. Worth exploring
whether the existing mark can be *evolved* toward that reading (shape/negative-space
adjustments that lean into the blinder association) rather than replaced outright — lower
risk than a from-scratch redesign, and reuses brand equity already spent on the ◆. Note the
diamond also isn't rendered consistently black across contexts today (the README shows it
black; the app doesn't always) — worth deciding whether it should be, as part of the same
pass.

This needs a real design hand (Fable, architect-on-call, standing in for Muriel/Design crew
per CLAUDE.md §7) to actually explore the concept — not an implementer guessing at shapes.

---

## Design exploration (Fable, architect-on-call for Muriel/Design crew, 2026-07-19)

### What actually exists today (audited before proposing anything)

There are **two unrelated marks** in the repo right now, not one:

1. **`docs/media/logo.svg`** — a rounded-rect badge containing blue harness *brackets*
   (`[ ]`-like clasps), the word `dh` in mono, and a small green accent circle. **This is the
   asset the owner finds too literal / unintentionally suggestive.** It does **not** contain a
   diamond at all.
2. **The `◆` glyph (U+25C6)** — the thing the owner actually likes — appears in:
   - `README.md` title: `# ◆ Dark Harness` — rendered as a plain text glyph, so it takes the
     heading's **ink/theme text color** (near-black on GitHub light, near-white on dark).
   - `src/web/client/styles.css` `.brand::before { content: "◆ "; color: var(--accent); }` —
     rendered **amber `#f5a524`**.
   - `src/web/client/index.html` favicon — an inline SVG diamond, **amber `#f5a524`**.
   - `docs/design/social-preview-prompt.md` — amber diamond.

So the "inconsistency" the owner noticed is not *black-vs-not-black*: in every app surface the
diamond is **amber**, and only in the README (which can't color a markdown-heading glyph) is it
**theme ink**. That distinction drives the color recommendation below.

The ASCII banner (`src/prompt/banner.constant.ts`) is a figlet-style `dh` with **no diamond**;
`DH_ASCII_LOGO_COMPACT` is `[ dh ]`. Neither carries the mark today.

### The one architectural constraint that shapes everything: glyph tier vs. SVG tier

The mark has to survive in two fundamentally different rendering environments, and this is the
crux of the whole redesign:

- **Glyph tier** — contexts where the mark is *literally the character `◆`* and no custom
  geometry is possible: the README heading, the CSS `content:` pseudo-element, plain-text logs,
  the TUI/ASCII banner. Here you get a diamond and its color, nothing more.
- **SVG tier** — contexts that render real vector art: `docs/media/logo.svg`, the favicon, the
  social-preview image, and (if we choose) the web header and README hero via an inline
  `<img>`.

**Any evolution that depends on negative-space carving or added strokes exists only in the SVG
tier — it cannot be reproduced by the bare `◆` glyph.** A redesign that ignores this ships a
fancy hero mark and a plain diamond everywhere else, and they won't read as the same identity
unless we plan for it. My recommendation therefore treats this as a deliberate **two-tier mark
system**: the plain `◆` is the canonical *reduced* form (glyph tier), and the evolved blinder
art is the *full* form (SVG tier). The reduced form must still be recognizably the same mark —
which is an argument for evolving the diamond *gently* rather than mutilating its silhouette.

### Three concrete directions

All three assume the mark sits to the **left** of the wordmark "Dark Harness," cupping/opening
*toward* the text — because a blinder shields one side and leaves the forward view open, and
here the wordmark *is* the forward view. In all three, the word "Harness" does real semantic
work: the owner's own observation is that the plain diamond *already* reads as a blinder **next
to the words** — meaning context carries much of the load and the silhouette needs a lean, not
a transplant.

#### Concept 1 — "The Blinker" (gentle inner-side evolution) — RECOMMENDED

Keep the diamond's three **outer** points sharp (top, left, bottom) — the rigid outer edge of
the leather cup, facing away from the eye. Evolve only the **inner (right, wordmark-facing)**
side: pull its point inward and bow the two right edges slightly **concave**, so that side
reads as a scooped leather cup opening toward the wordmark. Punch a single small **circular**
negative-space hole (a round eye / rosette rivet) just inside the cup. The outer silhouette
still reads unmistakably as a diamond; the one cupped side + round eye tip it into "blinker."

Starting SVG geometry (128×128 viewBox, amber fill, `evenodd` to punch the eye — control points
are a starting point, to be tuned by eye by the implementer):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"
     role="img" aria-label="Dark Harness">
  <path fill-rule="evenodd" fill="#f5a524" d="
    M64 16 L16 64 L64 112
    Q70 84 84 64
    Q70 44 64 16 Z
    M70 56 a8 8 0 1 0 0.01 0 Z"/>
</svg>
```

Read of that path: `M64 16 L16 64 L64 112` draws the sharp outer half (top→left→bottom); the two
`Q` curves return bottom→inner-vertex(84,64)→top with the control points pulled toward center to
bow the right side concave; the trailing `M70 56 a…` is the round eye punched by `fill-rule`.

**Assessment (honest):** This is the direction with the best payoff-to-risk. It keeps the clean
diamond the owner explicitly likes, leans just far enough that "Harness" completes the blinder
reading, and is the least likely to look like a gimmick. The reduced glyph tier degrades
cleanly to a plain `◆` (the eye/scoop are simply absent at glyph tier — acceptable, same mark).
Two risks I'm designing *against* explicitly: (a) too deep a scoop reads as a crescent/"bitten"
diamond — keep it shallow; (b) the eye must be a **circle, not a vertical almond** — an almond
negative-space inside a cupped shape risks re-introducing exactly the anatomical misread that
started this ticket. Round eye = reads as eye/rivet/harness boss, unambiguous. **This is my
recommendation, contingent on an owner look, for the reasons in "Status" below.**

#### Concept 2 — "The Rosette Boss" (harness-hardware authenticity)

Keep the `◆` fully intact and whole. Add two **thin crossing straps** behind it — a horizontal
cheekpiece and a vertical crownpiece — so the diamond reads as the decorative metal **boss /
rosette at a strap junction**, which is literally what a diamond concho *is* on real harness
hardware. Straps in a muted ink/border color, diamond in amber on top.

**Assessment:** The most *authentic* and least risky-per-pixel, and it keeps the diamond
pristine. But it pivots the reading from the owner's specific "blinder" lead to a generic
"harness hardware" one, and it adds visual complexity (crossing straps) that (a) fights a
minimalist single-binary-CLI aesthetic and (b) **vanishes at favicon/16px and disappears
entirely at glyph tier** — leaving a plain diamond with none of the concept. Strong idea,
weaker fit for a mark that must live mostly as a bare glyph. Good fallback if Concept 1's scoop
doesn't land for the owner.

#### Concept 3 — "The Shielded-Eye lockup" (minimal mark, context does the work)

Leave the `◆` silhouette essentially unchanged (at most a tiny round eye-dot in the SVG tier).
Do all the work in the **lockup**: set the diamond tight and vertically centered to the cap
height immediately left of "Dark," so the pairing itself reads as the blinder framing the
forward view. This is the lowest-risk option and it *is* also the DH-0193 padding fix — mark
evolution and spacing resolved in one move — but on its own it's the least visually distinctive
(it's "a diamond next to words"); it relies entirely on the viewer making the blinder leap the
owner made.

**Assessment:** Safest, cheapest, most reversible; also the least design-forward. Best thought
of not as a rival to Concept 1 but as its *lockup layer* — Concept 1's silhouette **plus**
Concept 3's lockup discipline is the complete answer, which is how I've specced the recommended
requirements below.

### Recommendation

**Ship Concept 1 ("The Blinker") as the full SVG-tier mark, governed by the two-tier system
(plain `◆` as the reduced glyph tier), laid out with Concept 3's lockup/padding discipline
(which also closes DH-0193).** Reasoning: it evolves rather than replaces (reuses the brand
equity the owner explicitly wants kept), it's the only option that reads specifically as the
owner's *blinder* lead while staying clean, and its reduced form is a graceful plain diamond
everywhere the glyph tier forces one. Concept 2 is the fallback if the owner wants the diamond
untouched.

### Color decision (resolves the "not consistently black" question)

**The mark's one canonical brand color is amber `#f5a524`, in every context that can render
color** (all SVG-tier surfaces: `logo.svg`, favicon, social preview, and the web header). It is
**not** black, and it should **not** flip to ink where color is available — a brand mark has one
color identity. The README/CSS split today is a bug of omission, not intentional variation.

- Where a context **cannot** set a glyph's color — a markdown-heading `◆`, the TUI/ASCII
  banner, plain-text logs — the mark degrades to the surrounding **ink/default color**. That is
  an accepted, documented degradation (same spirit as the style guide's "color is never the
  only signal" and the TTY-gated liveness contract), **not** an inconsistency to chase.
- **Exception worth fixing:** the README hero *can* render real color via an inline
  `<img src=".../logo.svg">` in the `# ◆ Dark Harness` heading (GitHub allows `<img>` in
  headings). Since the README is the most-seen surface, upgrade it from the raw text glyph to
  the actual amber SVG mark. The `◆` text glyph stays acceptable anywhere an `<img>` is
  overkill.

Net: **amber everywhere color is possible; ink fallback only where the medium can't carry
color; README upgraded to the real SVG so it shows canonical amber.**

### ASCII / glyph-tier honesty

The blinker scoop and eye **do not survive to ASCII** — that's expected and fine; ASCII is the
reduced glyph tier. The ASCII banner should simply carry a **diamond + wordmark**, e.g. a small
slash-drawn diamond left of the figlet `dh`, and `DH_ASCII_LOGO_COMPACT` becoming `<> dh` (kept
byte-plain ASCII per banner.constant.ts's existing no-Unicode/no-SGR rule — do **not** bake the
`◆` U+25C6 glyph into the ASCII constants). Exact ASCII art is Prompt-domain (Iris) execution;
this ticket only fixes the *identity* it should express (diamond, not the old brackets).

## User Stories

_Provisional on the owner's concept pick (see Status) — written against Concept 1, the
recommended direction, so blessing it is a short hop to `ready`._

### As a visitor to the repo, I want the logo to read as a stylized harness blinder next to the wordmark, not as an unintentionally suggestive shape

- Given the redesigned `docs/media/logo.svg`, when it is rendered, then it shows the amber
  Concept-1 blinker mark (diamond with sharp outer points, a shallow concave inner/right side,
  and a single round negative-space eye) and no longer contains the old blue brackets, `dh`
  text, or green accent circle.

### As a user seeing `dh` across surfaces, I want the brand mark to be the same identity everywhere

- Given any SVG-tier surface (logo asset, favicon, social preview, web header), when the mark
  renders, then it is amber `#f5a524`.
- Given a glyph-tier surface that cannot color a glyph (TUI/ASCII banner, plain-text logs), when
  the mark renders, then it degrades to the surrounding ink/default color, and this is the only
  place the mark is non-amber.
- Given the README hero heading, when it renders on GitHub, then the mark is the actual amber
  SVG (inline `<img>`), not a raw text glyph.

### As a user, I want the reduced (glyph-tier) mark to still read as the same diamond

- Given a context where only the bare `◆` glyph is available, when it renders, then it is a
  plain diamond in the correct tier color and is recognizably the same mark as the full SVG.

## Functional Requirements

- Replace `docs/media/logo.svg` with the Concept-1 "Blinker" mark (starting SVG above; final
  scoop depth and eye placement tuned by eye during implementation). Amber `#f5a524`. No
  brackets/`dh`-text/green-dot.
- Standardize the mark color to amber `#f5a524` on every color-capable surface; keep the `◆`
  glyph's ink degradation only where the medium can't carry color; upgrade the README hero to
  an inline amber SVG `<img>`.
- Update the ASCII banner identity (`src/prompt/banner.constant.ts`) to express a diamond +
  wordmark (byte-plain ASCII, no `◆`/SGR), replacing the bracket-era identity. Exact art is
  Iris/Prompt-domain execution.
- Keep the two-tier contract: plain `◆` is the canonical reduced form; the blinker art is the
  full SVG form; both are the same identity.
- Fan-out on implementation mirrors DH-0121: **Web** (Susan) owns `logo.svg` + favicon + web
  header + social preview; **Prompt** (Iris) owns the ASCII banner + README; **TUI** (Mary)
  owns ASCII rendering. Lockup/padding is shared with **DH-0193**.

## Assumptions

- The owner keeps the diamond as the root of the identity (stated explicitly 2026-07-19).
- GitHub renders an inline `<img>` inside a markdown `#` heading (it does).

## Risks

- Design taste is the owner's call. Presented as three options with a clear recommendation, not
  a fait accompli, per the ticket's original Risk and CLAUDE.md §6's note that taste routes to
  the owner.
- Concept 1's scoop, if too deep, reads as a crescent/bitten diamond; the eye, if a vertical
  almond rather than a circle, risks re-introducing the anatomical misread that started this
  ticket. Both explicitly designed against above (shallow scoop, round eye) — but this is the
  concrete reason an owner look before implementation is warranted.

## Open Questions

- Owner: Concept 1 (recommended), Concept 2 (diamond untouched, add crossing straps), or
  Concept 3 (minimal, lockup-only)? Implementation is specced against Concept 1.

## Status

**`refining`, deliberately.** The recommendation (Concept 1 + amber-canonical + two-tier) is
concrete enough to build directly, but design taste is inherently the owner's call more than a
typical CLAUDE.md §6 escalation, and this ticket's own Risk requires presenting options rather
than picking one unilaterally — especially given the mark's origin as an *unintended* misread,
where a second set of eyes before implementation is cheap insurance. On owner sign-off of a
concept this moves straight to `ready` with the User Stories above (adjusted only if a fallback
concept is chosen). Padding is fully specced in DH-0193 and lands in the same pass.

## Notes

- 2026-07-19 (Fable): design exploration added; status draft → refining. Audited the true
  state (two unrelated marks; app-diamond is amber not black), surfaced the glyph-tier vs
  SVG-tier constraint as the governing architectural decision, recommended Concept 1 with amber
  as canonical brand color. DH-0193 filled in as the shared lockup/padding half.
