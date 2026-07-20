---
spile: ticket
id: DH-0192
type: bug
status: closed
owner: stefan
resolution: superseded
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0121, DH-0193, DH-0198]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0192: Brand mark — standardize the diamond on ink (not amber), and redraw the ASCII banner to the bracket lockup

## Summary

Owner review of DH-0121's delivered logo (docs/media/logo.svg / ASCII banner in
`src/prompt/banner.constant.ts`), 2026-07-19: the current identity is too literal / reads
unintentionally suggestive. Original routing: through Muriel (Design crew) first per CLAUDE.md
§7, then fan-out to the consuming domains (Prompt for ASCII, Web for SVG/CSS, TUI for ASCII
render) — same fan-out DH-0121 used.

**This ticket has been rescoped twice against real owner corrections (see the two dated
exploration blocks below). The net of both rounds:**

1. **Keep the `◆` diamond, and keep it visually abstract** — do **not** evolve its silhouette.
   The owner rejected the "Blinker" scoop+eye evolution (round 1's recommendation): "I like the
   abstractness of the diamond, not so much the recommended alternative."
2. **The mark's canonical color is ink/foreground (currentColor), not amber.** The owner's
   blinder reading — the whole creative lead — only holds when the diamond is **dark**: "the
   diamond only looks like a blind when it is black." A hued amber diamond reads as a decorative
   gem and loses the blinder association. See the color resolution below; this reverses round 1's
   "amber everywhere" recommendation.
3. **`docs/media/logo.svg` (the blue-brackets + `dh` + green-dot badge) is *not* the suggestive
   asset, and the owner is now fine with it** (they had literally never seen it rendered — see
   DH-0198 — and, shown it clearly, are content with it). It does **not** need a redesign.
4. **The actual suggestive asset is the ASCII banner** (`DH_ASCII_LOGO`, the figlet-style `dh`):
   "the ascii version of the old dh logo is the one that is suggestive." The owner wants it
   redrawn to resemble `logo.svg`'s visual concept — **harness brackets clasping "dh"** — rather
   than the current figlet blob. Concrete replacement art is drafted below.

So the remaining work is two clean, separable pieces with different owners, both specced to
`ready` here: **(A) mark color standardization** (Web/Grace — CSS + favicon + social) and
**(B) ASCII banner redraw** (Prompt/Iris). They are kept in one ticket because they are the two
halves of the same brand-identity fix; splitting would add tracking overhead for the owner who
has already iterated twice.

---

## Design exploration — round 2 (Fable, architect-on-call for Muriel/Design crew, 2026-07-19)

*Round 1's exploration (three silhouette concepts + an "amber everywhere" color call) is
preserved verbatim at the bottom under "Superseded — round 1" for provenance. Read this section
for the current design; round 1 is history the owner has explicitly corrected.*

### The color resolution (this is the crux — worked through, not picked)

The owner's correction sets up an apparent conflict: a brand mark "wants" one canonical color,
but the blinder reading (the creative lead this whole ticket rests on) "only works when the
diamond is black." Round 1 resolved that conflict the wrong way — it kept amber and treated the
README's ink diamond as the bug. Taking the owner's observation seriously inverts it:

**The mark's canonical color is the surface's foreground/text color (`currentColor` / the theme
`--fg`) — i.e. ink: near-black on light surfaces, near-white on dark surfaces. It is *not*
amber.** Reasoning, in order of weight:

1. **It's what makes the mark work.** The blinder = dark leather. A hued amber diamond reads as
   a decorative gem/accent and drops the association; a hue-less, foreground-toned diamond reads
   as a solid architectural shape — a blind — exactly as the owner observed. The owner named the
   constraint; ink satisfies it, amber violates it.
2. **A wordmark lockup wants the mark and the words in one color.** "◆ Dark Harness" reads as a
   single unit when the diamond shares the wordmark's ink; an amber diamond beside ink words
   floats as a separate decorative accent, which is precisely the "not consistently colored"
   discomfort. Same-color = one lockup = the blinder-framing-the-name reading the owner wants.
3. **"Mark inherits foreground" is a *single* consistent rule** — which resolves the original
   "not rendered consistently" complaint *better* than forcing amber did. Today's real state:
   the README `◆` already inherits heading ink (correct), and it's the **app** that's the odd
   one out (`.brand::before { color: var(--accent) }` paints it amber). So the fix is: the app
   stops overriding to amber; every surface lets the diamond take foreground ink. The README
   needs **no change** — it was already right.
4. **Amber is retained — as the accent, not the mark.** `#f5a524` stays the app's accent color
   for status/liveness (running agents, links, the agent-node dot — the spirit of the old
   logo's green dot). The brand becomes a clean **ink mark + warm-amber accent** system, and the
   mark no longer competes with the accent. Nothing about amber's role in the UI changes; only
   the *mark* stops borrowing it.

Note this is theme-relative, not literally `#000`: on the web app's dark background
(`#0b0d12`) `currentColor` is the light text tone and the diamond is near-white — inverted along
with the whole UI, standard for any monochrome mark, and still unmistakably the dh diamond. The
blinder reading is strongest on light surfaces (GitHub README, light theme); on dark surfaces
the mark inverts with everything else, which is correct and expected.

**Fixed-medium surfaces** (favicon, social-preview image) have no live "surface color" to
inherit, so they get an explicit choice that honors the same rule: ink on light, light on dark.
For the favicon, an SVG `@media (prefers-color-scheme)` swap gives the theme-adaptive behavior;
for the social-preview image, the diamond is the foreground tone against that image's fixed
background (matching the wordmark on it), **not** amber.

### Silhouette: unchanged

The `◆` stays a plain, abstract diamond. No scoop, no negative-space eye, no crossing straps —
all of round 1's shape evolutions are dropped per the owner. This also means **`docs/media/logo.svg`
does not change** as part of this ticket: it's the separate brackets-badge asset, the owner is
fine with it, and there is no diamond in it to restyle. (If it is ever unified with the diamond
mark, that's a future decision the owner has not asked for — do not fold it in here.)

### Two coexisting brand expressions — intentional, do not "reconcile"

After this ticket the repo intentionally carries **two** brand expressions, and the owner is
content with both:

- **The `◆` diamond** — the primary mark, glyph-tier: README heading, web header, favicon,
  social preview. Ink/foreground toned (this ticket).
- **The bracket lockup `[ dh ]`** — the `logo.svg` badge concept, and now the ASCII banner's
  identity (below). Owner is fine with `logo.svg` as-is.

Implementers should **not** try to force these into one identity — the owner likes the diamond
*and* wants the ASCII to look like the brackets. Stated here so nobody "helpfully" unifies them.

### (B) ASCII banner redraw — concrete art

The current `DH_ASCII_LOGO` is the suggestive figlet (its top `_  _` and central `||`
double-stem are the misread). Redraw it to evoke `logo.svg`'s concept — a rounded badge / harness
brackets clasping a clean, legible "dh", with the green-dot accent — and drop the blob. Must stay
**byte-plain ASCII**: no Unicode (no `◆`), no box-drawing, no SGR, per `banner.constant.ts`'s
existing rule (callers TTY-gate color/glyphs themselves).

**Proposed replacement for `DH_ASCII_LOGO` (primary draft — Iris tunes final kerning):**

```
 _                       _
|                         |
|      |   |              |
|    __|   |__            |
|   |  |   |  |           |
|   |__|   |  |  o        |
|_                       _|
```

Read: the outer `|` frame with `_` corners is the rounded badge / bracket clasp (the `logo.svg`
silhouette); inside, the left group (`|` stem right, bowl lower-left) is a lowercase **d**, the
right group (`|` stem left, arch right) is a lowercase **h** — the two stems are held well apart,
so there is no central double-stem to misread. The `o` is the green agent-node dot from
`logo.svg`. This is deliberately more legible-as-"dh" and less ornamental than the old figlet.

**`DH_ASCII_LOGO_COMPACT` stays `[ dh ]`** — it already *is* the bracket-clasp concept and was
never the suggestive asset; no change.

*(Alternative if the framed-badge look is too heavy at some render widths: drop the outer frame
and keep just tall `[ ]` brackets around the same "dh" glyphs. Iris's call at execution.)*

## User Stories

### As a user seeing `dh`, I want the diamond mark to be the same ink-toned identity as the wordmark on every surface

- Given any app surface that renders the `◆` mark (web header, favicon, social preview), when it
  renders, then the mark is the surface's foreground/ink tone (`currentColor` / `--fg`), **not**
  amber `#f5a524`.
- Given the web header specifically, when it renders, then `.brand`'s mark no longer takes
  `var(--accent)`; it takes the foreground text color, matching the "Dark Harness" wordmark
  beside it.
- Given the README hero heading, when it renders on GitHub, then the `◆` continues to take the
  heading's ink color (already correct — asserts no regression, no change required).
- Given the app's accent color, when status/liveness elements render (running agents, links,
  agent-node dot), then amber `#f5a524` is still used there — only the *mark* stops using it.

### As a visitor, I want the ASCII banner to read as brackets clasping "dh", not as the old suggestive figlet

- Given `DH_ASCII_LOGO`, when it is rendered in the TUI/CLI banner, then it shows the bracket/
  badge lockup clasping a legible "dh" (per the draft above), is byte-plain ASCII (no Unicode,
  box-drawing, or SGR), and no longer contains the old figlet form.
- Given `DH_ASCII_LOGO_COMPACT`, when it renders, then it remains `[ dh ]` (unchanged).

### As a user, I want the diamond to stay a plain, abstract diamond

- Given the `◆` mark on any surface, when it renders, then its silhouette is an unmodified
  diamond (no scoop, negative-space eye, or added strokes).

## Functional Requirements

- **(A) Color — Web (Susan) / Core-CLI (Grace) as applicable:**
  - `src/web/client/styles.css`: `.brand::before` (and any structural mark element introduced by
    DH-0193) uses the foreground/text color, not `var(--accent)`.
  - `src/web/client/index.html` favicon: ink on light / light on dark (SVG
    `@media (prefers-color-scheme)`), not fixed amber.
  - `docs/design/social-preview-prompt.md`: diamond is the foreground tone against the image's
    background, not amber.
  - README hero: no change required (already inherits heading ink). Do **not** convert it to an
    amber `<img>` — that was the reversed round-1 call.
  - Amber `#f5a524` remains the accent token for status/liveness/links/agent-node — unchanged.
- **(B) ASCII — Prompt (Iris):** replace `DH_ASCII_LOGO` in `src/prompt/banner.constant.ts` with
  the bracket-lockup art above (byte-plain ASCII; final kerning Iris's call). Leave
  `DH_ASCII_LOGO_COMPACT` as `[ dh ]`.
- **Do not** modify `docs/media/logo.svg` (owner is fine with it; no diamond in it to restyle).
- **Do not** evolve the `◆` silhouette.
- Lockup/padding around the mark is DH-0193 and lands in the same pass.
- DH-0198 (web header never renders a real mark asset) consumes the final mark form settled here
  — see its cross-reference.

## Assumptions

- The owner keeps the `◆` diamond as the primary mark, plain/abstract (stated 2026-07-19).
- The owner is content with `docs/media/logo.svg` as-is (stated 2026-07-19).
- Two brand expressions (ink `◆` mark + `[ dh ]` bracket lockup) coexisting is acceptable to the
  owner and is intentional.

## Risks

- Design taste is the owner's call; this round *executes* the owner's explicit corrections rather
  than proposing new taste, so the residual taste risk is low. The one decision that follows by
  implication rather than by the owner's literal words is **demoting amber from the mark to
  accent-only** — it's the direct logical consequence of "the diamond should be black," and is
  called out here so the owner can bounce it if they disagree, but it is not gating.

## Open Questions

- None gating. (Round 1's "which concept?" question is resolved: none — plain diamond, ink color,
  ASCII redrawn to brackets.)

## Status

**`ready`.** Both halves execute the owner's explicit 2026-07-19 corrections and have concrete
FRs, User Stories, and (for the ASCII) drafted art. Fan-out mirrors DH-0121: Web (Susan) owns the
color standardization (CSS/favicon/social); Prompt (Iris) owns the ASCII redraw; padding is the
shared DH-0193, same pass. `docs/media/logo.svg` is intentionally untouched.

## Notes

- 2026-07-19 (Fable, round 2): rescoped against two owner corrections. Dropped Concept 1
  (silhouette stays plain). **Reversed the color call: mark is ink/foreground `currentColor`, not
  amber** — the blinder reading requires a dark mark; amber demoted to accent-only. Refocused the
  redesign onto the **ASCII banner** (the actual suggestive asset) with concrete bracket-lockup
  art; `docs/media/logo.svg` is fine as-is and untouched. Status refining → ready.
- 2026-07-19 (Fable, round 1): initial exploration (preserved below, superseded).

---

## Superseded — round 1 exploration (2026-07-19, kept for provenance)

*The owner corrected this round: rejected Concept 1's silhouette evolution and reversed the
amber color call. Retained only as history — do not build from this section.*

Round 1 audited that there are two unrelated marks (`logo.svg` brackets-badge vs. the standalone
`◆` glyph), surfaced a glyph-tier vs. SVG-tier constraint, and proposed three silhouette concepts
— **Concept 1 "The Blinker"** (concave inner side + round negative-space eye, recommended),
Concept 2 "The Rosette Boss" (crossing straps behind an intact diamond), Concept 3
"Shielded-Eye lockup" (silhouette untouched, work done in the lockup). It recommended Concept 1
plus **amber `#f5a524` as canonical everywhere color is possible**, with ink only where the
medium can't carry color, and upgrading the README hero to an inline amber `<img>`. Round 2
supersedes all of it: silhouette stays plain (owner rejected Concept 1), and the canonical color
is ink/foreground, not amber (the blinder reading needs a dark mark). The glyph-tier/SVG-tier
observation remains true but is no longer load-bearing, since nothing is being carved into the
silhouette.

**Closed 2026-07-19 (superseded, round 3):** the diamond direction itself — evolved or plain —
is abandoned entirely. A separate Fable design session produced a full handoff covering both
the CLI startup headers and a completely different logo concept: a plain uppercase "D H"
monogram (no diamond, no blinder reading at all). See **DH-0219** (logo) and **DH-0220** (CLI
headers) for the final direction the owner actually shipped.
