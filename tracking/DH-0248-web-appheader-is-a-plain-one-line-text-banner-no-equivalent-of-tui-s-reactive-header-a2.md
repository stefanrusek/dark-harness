---
spile: ticket
id: DH-0248
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0245, DH-0219, DH-0224, DH-0122, DH-0135]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0248: Web: AppHeader is a plain one-line text banner, no equivalent of TUI's reactive Header A2

## Summary

Owner live-testing finding (2026-07-20): the Web client's transcript view shows no branded
header at launch beyond a thin single-line status bar (`AppHeader.tsx`: plain `DARK HARNESS`
text + version + a single ellipsized config-status line, no color, no monogram). This is by
design per DH-0224's rollout note (`buildHeaderInfo`'s `logoCompact` is the plain-text
`HEADER_A2_WORDMARK_PLAIN` fallback) — not a wiring bug, confirmed via a real headless-browser
check that the header does render with real (if plain) content. Now that DH-0245 gave the TUI
a real, persistent, full-color Header A2 experience inside the interactive session, the Web
client visibly lags — the owner expected an equivalent branded moment on launch and instead
sees a lifeless one-liner. The real DH-0219 monogram SVG (`LogoMark.tsx`, green→cyan gradient)
already exists and is used in the sidebar's `.brand` row.

**This ticket gives the Web transcript view its own real branded masthead** — the Web-native
equivalent of the TUI's Header A2 moment, built in Web's actual visual language (real SVG, CSS
gradients, the existing `--bg`/`--panel`/`--text` token system), **not** a literal port of the
TUI's ASCII-art aesthetic or its "scroll into the transcript" mechanic.

### Design decisions (the shape an implementer builds to)

**1. Placement — upgrade the existing full-width `.app-header-slot`, don't invent a new slot.**
`App.tsx` already reserves a full-width grid band (`grid-template-areas: "header header"`,
`grid-template-rows: auto 1fr`) spanning both the sidebar and main columns at the top of the
page, currently holding the thin `<AppHeader>`. That band *is* the natural home for a masthead
— upgrade `<AppHeader>` in place rather than pushing a hero into the transcript panel. Because
the header grid row is sized `auto`, a taller masthead simply grows the row; there is **no**
frame-height / content-rows recalculation to do (unlike the TUI, whose fixed-row budget forced
DH-0245 into the scrollable transcript).

**2. Persistence — a fixed, always-visible masthead. Explicitly NOT scroll-with-transcript.**
DH-0245's "must scroll with content, revealed by scrolling to the top" requirement was a fix
for a *TUI-specific bug*: Ink's alt-screen clear wiped the pre-mount banner, and a synthetic
leading transcript entry was the only way to make it survive and reappear. **The Web has no
alt-screen wipe.** The native web idiom for a persistent brand + status band is a fixed
masthead that never scrolls away — which is strictly *better* than the TUI outcome (the TUI's
banner is hidden the moment you scroll down; the Web masthead stays glanceable the whole
session). We deliberately do not put the brand moment inside `Transcript.tsx`'s scroll region.

**3. Content — three zones; never drop information the current one-liner carries.**
The masthead reads left→right as brand → build → config instrument:
   - **Brand zone (left):** the `<LogoMark>` SVG at masthead scale (~28px, up from the 18px
     sidebar mark) + a **"Dark Harness" wordmark rendered with a green→cyan gradient text
     fill** — the CSS analog of Header A2's per-character gradient wordmark. This is the
     branded launch moment.
   - **Build zone:** the version/build identity (`formatVersionString(headerInfo.build)`) in
     dim monospace.
   - **Config instrument zone (right-aligned):** the `dh.json` facts currently crammed into
     one ellipsized `formatConfigStatusLine` string, broken out into discrete labeled chips
     that echo Header B's instrument panel — a `config <path> · N models` chip, a `bind <host>`
     chip, an **auth** chip (`token required` neutral, or `⚠ no token` in the warning accent),
     and a `tls` chip when TLS is on. The rendered chip set must carry **at least** every fact
     `formatConfigStatusLine` renders today (path, model count, bind host, token state, tls) —
     no information regression.

**4. Color — reuse the exact BRAND gradient stops so mark and wordmark read as one object.**
The wordmark gradient uses `#9ECE6A → #7DCFFF` (`BRAND.harnessGreen → BRAND.signalCyan`), the
**same two stops `LogoMark`'s own SVG `linearGradient` uses** — so the monogram and the
wordmark next to it read as a single continuous gradient object, not two unrelated greens.
Expose them as CSS custom properties (`--brand-grad-start: #9ECE6A; --brand-grad-end: #7DCFFF`)
in `:root` so the value lives in one place. The auth-warning chip uses the existing `--accent`.

## User Stories

### As an operator opening the Web UI, I want a real branded masthead at launch, not a lifeless one-liner

- Given the Web client boots with a `headerInfo`, when the page first renders, then the
  top-of-page masthead shows the real `<LogoMark>` monogram SVG **and** a "Dark Harness"
  wordmark (not just the plain-text `logoCompact` string) — proven by a component test that
  the rendered `.app-header` (or its successor `.app-masthead`) contains the `<svg>` mark and
  the "Dark Harness" text.

### As an operator, I want the masthead's wordmark to carry the brand gradient, echoing the TUI's colored Header A2

- Given the masthead renders, when the wordmark is styled, then it uses a green→cyan gradient
  fill sourced from the same `#9ECE6A → #7DCFFF` stops as `LogoMark`'s SVG gradient — proven
  by a test asserting the wordmark element's computed/inline style references the
  `--brand-grad-start`/`--brand-grad-end` custom properties (or the literal stop hexes), and
  that those custom properties resolve to `#9ECE6A`/`#7DCFFF`.

### As an operator, I want the masthead to keep every config fact the old one-line header showed

- Given a `headerInfo` whose config summary has a path, model count, bind host, token state,
  and tls state, when the masthead's config instrument zone renders, then every one of those
  facts is present in the DOM (as discrete chips) — proven by a test that feeds a
  fully-populated `ConfigStatusSummary` and asserts each fact (path, `N models`, bind host,
  token/no-token, tls-on) appears, i.e. no regression against `formatConfigStatusLine`'s
  content.

### As an operator whose config requires no token, I want that surfaced as a visible warning, not buried in a gray line

- Given `headerInfo.config.hasToken === false`, when the auth chip renders, then it shows a
  warning-accent `⚠ no token` chip (color `--accent`), matching the cross-surface "no token"
  warning treatment the TUI header's `authText`/`warnGlyph` already uses — proven by a test
  asserting the auth chip carries the warning class and the ⚠ glyph when `hasToken` is false,
  and a neutral `token required` chip (no warning class/glyph) when true.

### As an operator, I want the masthead to stay visible the whole session, not scroll away

- Given a transcript long enough to scroll, when the operator scrolls the transcript region to
  the bottom, then the masthead is still fully visible at the top of the page (it lives in the
  fixed `header` grid area, outside `Transcript.tsx`'s `.output-scroll` region) — proven by a
  test/assertion that the masthead element is a child of `.app-header-slot` (the `header` grid
  area), not of `.output-scroll`, so it is structurally non-scrolling.

### As an operator on either theme, I want the masthead legible in light and dark mode

- Given the page renders under the light-theme `:root` palette and under the dark-theme
  palette, when the masthead renders, then its text (wordmark gradient, version, chip labels)
  meets legibility on both `--bg` values (`#0b0d12` dark, `#f5f6f8` light) — the gradient stops
  are mid-luminance and legible on both; the wordmark carries a solid `color: var(--text)`
  fallback beneath the `background-clip: text` gradient so browsers/contexts that don't paint
  clipped-text gradients still show a legible wordmark. Proven by a test asserting the fallback
  `color` is set on the wordmark element in addition to the gradient background.

### As an operator, I want a subtle branded entrance, not a static slab (delight)

- Given `prefers-reduced-motion: no-preference`, when the masthead first mounts, then the
  wordmark performs a single, brief (~350–450ms) fade-and-rise entrance (one-shot, never
  looping, never re-firing on re-render) — the "flashy little pop" the owner asked the design
  crew to deliver, kept calm and one-time. Given `prefers-reduced-motion: reduce`, when the
  masthead mounts, then no entrance animation runs and the masthead appears immediately.
  Proven by a test asserting the entrance animation is gated behind the reduced-motion media
  query (present under `no-preference`, absent under `reduce`).

## Functional Requirements

- Replace the thin single-line `<AppHeader>` body with a **masthead** rendered into the same
  `.app-header-slot` grid area (`App.tsx`, grid area `header`). Keep the `headerInfo`-absent
  contract: render `null` when `headerInfo` is `undefined` (tests and pre-`DH-0122` boots),
  exactly as today.
- Masthead structure (three zones): brand (`<LogoMark>` at ~28px + gradient "Dark Harness"
  wordmark) · build (`formatVersionString(headerInfo.build)`, dim monospace) · config
  instrument (right-aligned chip row). The chip row is built from `headerInfo.config`
  (`ConfigStatusSummary`) and must render every fact `formatConfigStatusLine` renders:
  `config <path>` + model count, `bind <hostname ?? "all interfaces">`, an auth chip
  (`token required` / `⚠ no token`), and a `tls` chip iff `hasTls`. Prefer reusing the existing
  formatter data (`ConfigStatusSummary` fields directly) over re-parsing the joined string.
- Wordmark gradient: `background: linear-gradient(90deg, var(--brand-grad-start),
  var(--brand-grad-end)); -webkit-background-clip: text; background-clip: text; color:
  transparent;` **plus** a solid `color: var(--text)` fallback declared *before* the
  `color: transparent` (or via `@supports` guard) so unsupported contexts show a legible
  wordmark. Add `--brand-grad-start: #9ECE6A; --brand-grad-end: #7DCFFF;` to `:root` in
  `styles.css` (mirroring `BRAND.harnessGreen`/`BRAND.signalCyan` and `LogoMark`'s SVG stops).
  Keep the same two values for the light-theme `:root` override block (they read on both
  backgrounds); do not invent per-theme brand hues.
- Auth-warning chip: when `!hasToken`, render `⚠ no token` colored `var(--accent)` with a
  `.chip-warn` (or equivalent) class; when `hasToken`, render a neutral `token required` chip.
  This matches the cross-surface "no token" warning treatment (style-guide §3; TUI
  `header.ts`'s `authText`/`warnGlyph`).
- Persistence: the masthead lives in the fixed `header` grid area and must **not** be moved
  into `Transcript.tsx`'s `.output-scroll` region. No change to `Transcript.tsx`'s empty-state
  text or scroll behavior is in scope — the masthead is the brand moment regardless of
  transcript state.
- Grid: the `header` grid row is already `auto`; confirm the taller masthead is accommodated by
  the existing `grid-template-rows: auto 1fr` with no `contentRows`/height recomputation (there
  is no such computation on the Web side — it is pure CSS grid). Ensure the masthead has
  `min-width: 0` / `overflow` handling so the config chip row wraps or truncates gracefully on
  narrow viewports rather than forcing horizontal page scroll (style-guide §responsive rules).
- Entrance animation: a single one-shot fade+translateY on the wordmark on mount, ~350–450ms,
  gated behind `@media (prefers-reduced-motion: no-preference)`; no animation under `reduce`.
  Must not loop or re-fire on subsequent React re-renders (a CSS `animation` on the mounted
  element, which only plays once per mount, satisfies this — do not drive it from a state that
  updates each render).
- Sidebar de-duplication (recommended, Susan's final taste call): with the masthead now
  carrying the large "Dark Harness" wordmark directly above the sidebar, the sidebar `.brand`
  row's wordmark *text* becomes a redundant second wordmark stacked immediately below it.
  Recommendation: keep the sidebar's small `<LogoMark>` (nav identity anchor) but drop the
  literal "Dark Harness" text from the `.brand` row, so the wordmark appears exactly once.
  This is a small `App.tsx`/`styles.css` change touching DH-0219's row — non-gating; if Susan
  prefers to keep both, that's acceptable, but the two-stacked-wordmarks result should be
  visually reviewed either way.

## Assumptions

- `headerInfo` remains threaded to `App.tsx` → `<AppHeader>` exactly as DH-0135 established
  (fetched once at boot, static for the process lifetime). No new data source is needed — every
  fact the masthead shows is already on `HeaderInfo`/`ConfigStatusSummary`.
- The green→cyan stops are legible on both the dark (`#0b0d12`) and light (`#f5f6f8`)
  backgrounds without per-theme tuning (mid-luminance hues). If a real contrast check during
  implementation shows the light-theme wordmark is marginal, darkening the light-theme
  `--brand-grad-*` values slightly is acceptable and stays within this ticket — but confirm
  before diverging, don't assume.
- `-webkit-background-clip: text` is supported by the client's target browsers (it is
  effectively universal in evergreen browsers); the solid-color fallback covers the rest.

## Risks

- **Two wordmarks.** Without the sidebar de-duplication above, the masthead wordmark and the
  sidebar `.brand` wordmark stack directly, top-left — the single most likely "looks off"
  outcome. Called out as a recommended change, but flag it in review regardless.
- **Gradient-text accessibility.** `background-clip: text; color: transparent` can defeat some
  high-contrast / forced-colors modes. The mandated solid `color: var(--text)` fallback plus
  the SVG mark (which carries `aria-label="DH — Dark Harness"`) keep the brand identity legible
  and announced even when the gradient doesn't paint.
- **Config chip overflow on narrow viewports.** The instrument chip row must wrap or truncate
  inside its own zone, never force horizontal scroll of the whole page (style-guide responsive
  rule). Verify at a narrow width.

## Open Questions

None blocking — the User Stories are the acceptance bar. The sidebar de-duplication and any
light-theme gradient-stop tuning are the two implementer/taste latitudes, both bounded above.

## Notes

Designed by Muriel (design crew) 2026-07-20 from the owner's live-testing report, alongside
DH-0245 (the TUI counterpart, now `verifying`). Key cross-surface call recorded in
`docs/design/style-guide.md` §6.2 (new): **the brand-launch moment is realized per surface in
that surface's native idiom** — TUI = a synthetic scrollable leading transcript entry (forced
by the alt-screen wipe); Web = a fixed non-scrolling masthead (no wipe to work around, and a
persistent masthead is the better web outcome) — but **both share one mark, one wordmark, one
green→cyan gradient** (`#9ECE6A → #7DCFFF`), so a user moving between surfaces sees the same
brand object, not two lookalikes. Do not "port" the TUI's scroll mechanic to Web; do share its
palette.

Implementation owner: **Susan** (`src/web/`). Touches `AppHeader.tsx`, `styles.css`, and
(recommended, non-gating) `App.tsx`'s sidebar `.brand` row. No `src/contracts/` change, no
change to `header-info.ts`'s shared builders (masthead consumes the existing `HeaderInfo` /
`ConfigStatusSummary` shape as-is), no ADR/invariant touched.
</content>
</invoke>
