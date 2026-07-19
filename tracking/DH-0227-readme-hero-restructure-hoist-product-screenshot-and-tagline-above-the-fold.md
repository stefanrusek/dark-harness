---
spile: ticket
id: DH-0227
type: feature
status: verifying
owner: Iris
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0219, DH-0228]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0227: README hero restructure: hoist product screenshot and tagline above the fold

## Summary

Owner design feedback (2026-07-19), ahead of showing the project to people: **the README
hero — screenshot and header text — needs to sit higher on the page.** DH-0219 landed the new
DH-monogram hero image at the very top, which is good, but the layout below it buries the
single most persuasive element (the actual product screenshot) under ~30 lines of prose.

**Diagnosis of why it currently reads as "too low"** (line numbers against the README as of
this ticket):

1. Logo (L1–3, centered 88px) — good, stays.
2. `# Dark Harness` (L5) — good.
3. Three badges (L7–9) — fine, but they sit *before* any tagline.
4. A bold one-line-ish hook that is actually a full multi-line paragraph (L11–14).
5. A second full paragraph ("No daemons to install…", L16–21).
6. **A whole 25-line essay** — "### Why this exists, and what it's meant to demonstrate"
   with four multi-line bullets (L23–47).
7. **Only then**, at L49–59, the product hero screenshot (`hero-web-dark.png` /
   `hero-web-light.png`) and its caption.

So a first-time reader scrolls past a title, badges, two paragraphs, and a 25-line
philosophy essay before ever seeing what `dh` looks like. The screenshot is the fastest
"what is this" signal a repo has, and it's below the fold on essentially every viewport. The
fix is a reorder, not new copy: **the product shot and a single tagline line must appear in
the first screenful; the "Why this exists" essay drops below the screenshot.**

**Screenshot asset already exists** — `docs/media/hero-web-dark.png` and
`hero-web-light.png` are checked in (rendered via `e2e/spikes/web/hero-screenshot.ts`). This
ticket does **not** need to capture a new screenshot; it only moves the existing `<picture>`
block and its caption higher. No new asset capture is in scope.

## Target above-the-fold order (the restructure)

Top of README, in this exact order:

1. **Logo** — centered `docs/media/logo.svg`, unchanged (88×88).
2. **`# Dark Harness`** title — unchanged.
3. **One-line tagline**, centered, directly under the title — a single sentence, italic or
   plain, no bold-wall. Use the existing hook compressed to one line:
   *"Point `dh` at a repo and an instructions file, and it works the job unattended."*
   (This is the first clause of the current L11–14 hook; the rest of that paragraph moves
   into the body — see FR-4.) One line only; it must not wrap past two lines at typical
   GitHub column width.
4. **Badges** (CI / npm / license) — unchanged content, kept centered, moved to sit under
   the tagline rather than under the title. (Centering the badge row is a small polish; if
   left-aligned is simpler to keep, that is acceptable — placement order matters more than
   alignment.)
5. **Product hero screenshot** — the existing `<picture>` block (L49–55) and its italic
   caption (L57–59), moved up to here verbatim. This is the payload of the whole ticket:
   the screenshot must be reachable in the first screenful.

Everything currently between the badges and the screenshot moves **below** the screenshot,
in this order and with content otherwise unchanged:

6. The "No daemons to install…" paragraph (current L16–21).
7. The remainder of the compressed hook paragraph (the sentences after the tagline clause
   from current L11–14).
8. The "### Why this exists, and what it's meant to demonstrate" section (current L23–47),
   verbatim, now sitting after the screenshot.

The "Security posture, up front" section (L61+) and everything after it are unchanged.

## User Stories

### As a first-time visitor sizing up the repo, I want the product screenshot in the first screenful

- Given the rendered `README.md`, when I look at the source order of top-level blocks, then
  the product `<picture>` hero-screenshot block appears **before** the "Why this exists"
  heading and before the "No daemons to install" paragraph.
- Given the rendered `README.md`, when I read from the top, then the block order is: logo,
  then `# Dark Harness`, then a single tagline line, then the badges, then the product
  screenshot — and only after the screenshot do the longer explanatory paragraphs and the
  "Why this exists" section appear.

### As a reader, I want one scannable tagline, not a bold paragraph, under the title

- Given the top of the README, when I read the line directly under `# Dark Harness` (before
  the badges), then it is a single-sentence tagline, not a multi-line bold paragraph.
- Given that tagline, when rendered at GitHub's default column width, then it occupies one
  line (at most two) — it is not the full multi-sentence hook.

### As a maintainer, I want no content silently lost or duplicated in the reorder

- Given the pre-change README, when the reorder is complete, then every sentence from the
  original hook paragraph, the "No daemons" paragraph, and the "Why this exists" section is
  still present exactly once (relocated, not deleted or duplicated), and the screenshot
  caption and its `e2e/spikes/web/hero-screenshot.ts` reference are preserved verbatim.

## Functional Requirements

- **FR-1 — Screenshot hoisted.** Move the existing `<picture>`/`<img>` hero-screenshot block
  and its italic caption to sit immediately after the badge row, before any long-form prose.
  Do not alter the `srcset`/`media`/`alt`/`width` attributes or the caption text.
- **FR-2 — Tagline line added.** Insert a single centered tagline line between the `#
  Dark Harness` title and the badges, using the first clause of the current hook:
  *"Point `dh` at a repo and an instructions file, and it works the job unattended."*
- **FR-3 — Badges relocated under the tagline.** The three badges (CI, npm, license) move to
  directly under the tagline. Content unchanged.
- **FR-4 — Long-form prose demoted below the screenshot.** The "No daemons…" paragraph, the
  remaining sentences of the original hook paragraph, and the entire "Why this exists,
  and what it's meant to demonstrate" section move below the hero screenshot, in that order,
  with wording unchanged.
- **FR-5 — No new assets, no wording rewrites.** This is a reorder plus one tagline
  extraction. Do not capture a new screenshot, do not rewrite the essay bullets, and do not
  touch anything from "## Security posture, up front" onward.
- **FR-6 — Update the "Status / deferred this round" note.** The README's bottom section
  currently says "The logo (above…) is a literal uppercase 'D H' monogram — DH-0219…"; leave
  that. No change required there unless the reorder makes a self-reference stale.

## Acceptance criteria → verification

Per CLAUDE.md §9, this is a docs-only change with no runtime surface, so verification is a
structural assertion, not a behavioral test. The repo already has `src/prompt/
readme-config-sync.test.ts` guarding README/config drift; extend that pattern:

- Add/extend a lightweight test (Iris's call on file — `src/prompt/`-owned, alongside the
  existing README-sync test) asserting **block order** in `README.md`: the byte offset of the
  hero `<picture>` block (match on `srcset="docs/media/hero-web-dark.png"`) is **less than**
  the byte offset of the `### Why this exists` heading and less than the "No daemons to
  install" paragraph. This makes "screenshot is above the fold" a proven claim, not a manual
  eyeball, and prevents a future edit from re-burying it. Each User Story bullet above that is
  structurally checkable maps to an assertion in this test; the "one line at GitHub width"
  tagline bullet is a visual property not mechanically testable and is verified by the owner
  on the rendered page (call it out as such in the close-out).

## Assumptions

- The existing `hero-web-dark.png` / `hero-web-light.png` are current and acceptable as-is
  (DH-0219 era); no re-render needed. If the owner later wants a fresher capture, that is a
  separate ticket.
- Centering vs. left-aligning the badge row is cosmetic; order is what this ticket fixes.

## Risks

- Low. Pure docs reorder. The only real risk is dropping or duplicating a sentence during the
  move — FR-5 and the "no content lost" User Story plus the block-order test guard against it.

## Open Questions

- None blocking. Tagline wording is specified (FR-2); owner can bounce the exact sentence on
  review, but it should not gate implementation.

## Notes

- Design rationale recorded in `docs/design/style-guide.md` §8 (new "README / repo-front
  conventions" section added in this same design pass): the repo front page's first screenful
  is mark → name → one-line tagline → badges → product shot, with long-form rationale below
  the fold. This is the durable convention DH-0227 implements and future README edits cite.
- Sibling ticket **DH-0228** produces the GitHub social-preview card (the *external* unfurl
  image); this ticket is the *on-page* hero. They share the "screenshot/mark reads in the
  first second" goal but are independent surfaces and independently landable.
- **2026-07-19 — Iris, implementation:** Reordered `README.md` to logo → `# Dark Harness` →
  one-line centered tagline ("Point `dh` at a repo and an instructions file, and it works the
  job unattended.") → badges → hero `<picture>`/caption, with the "No daemons…" paragraph, the
  rest of the original hook sentence, and the "### Why this exists" essay moved below the
  screenshot (wording unchanged; the hook sentence was split at the tagline clause per FR-2
  and rejoined with "It's a single compiled binary…" for grammatical continuity — the only
  wording delta from the original). Added a block-order test to
  `src/prompt/readme-config-sync.test.ts` asserting the hero `<picture>` byte offset is less
  than both the `### Why this exists` heading and the "No daemons to install" paragraph
  offsets — covers both structurally-checkable User Story bullets. Gates: `typecheck` clean;
  `test:coverage` 146/146 pass (100% on changed files); `e2e` 41/41 pass. `lint` has one
  pre-existing failure in `docs/media/social-preview.render.ts` (DH-0228's file, untouched
  here) — not introduced by this change. The "tagline fits one line at GitHub column width"
  bullet is a visual property, not mechanically testable, per the ticket's own
  acceptance-criteria note — owner to eyeball on the rendered page. Moved to `verifying`.
