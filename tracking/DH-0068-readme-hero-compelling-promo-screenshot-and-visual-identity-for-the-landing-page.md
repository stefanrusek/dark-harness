---
spile: ticket
id: DH-0068
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: [DH-0065, DH-0066]
  relates_to: [DH-0067]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0068: README hero: compelling promo screenshot and visual identity for the landing page

## Summary

The README's copy is strong (clear pitch, security posture up front, mode matrix), but the
page contains **zero imagery** — no screenshot, no logo, and its own Known-gaps section
admits "No logo or wordmark yet." For a product whose signature is *watching a tree of
agents work*, a reader currently has to imagine the UI. This ticket adds a hero screenshot
staged to portfolio standard (plus a small visual-identity pass) and — critically —
specifies exactly what that screenshot must show, and makes it reproducible with a
committed staging script rather than a one-off manual capture. Depends on DH-0065/DH-0066:
shooting the hero before the Markdown-surface and sidebar-hierarchy polish lands would
immortalize the current gaps (unstyled code blocks, flat UUID sidebar) at the top of the
repo.

## User Stories

### As a prospective user skimming GitHub, I want to see what dh looks like before reading a word

- Given the README, when rendered on GitHub, then a hero image appears immediately after
  the opening pitch paragraph (before "Security posture"), inside a
  `<picture>`/`#gh-dark-mode-only` pairing so dark-theme and light-theme GitHub each get
  the matching UI theme variant.
- Given the image file, when committed, then it lives at a stable path (suggest
  `docs/media/hero-web-dark.png` + `-light.png`), referenced with meaningful alt text
  ("Dark Harness web UI observing a multi-agent session").

### As the owner, I want the hero staged so it actually sells the product

Requirements for the shot — what "looks great in a portfolio" concretely means here,
grounded in what the review found photogenic and what it found embarrassing:

- **Web UI, dark mode** as the primary hero (the review's dark captures are already far
  more striking than light; the palette is the product's aesthetic identity).
- **A real multi-agent session**: sidebar showing 4–6 agents with visible hierarchy
  (post-DH-0066 indentation) and **mixed statuses** — at least one blue `running` (pulse
  dot), one amber `waiting`, one green `done`, one red `failed` — so the status system,
  the product's core glanceability feature, is demonstrated in one frame.
- **Rich Markdown mid-transcript** (post-DH-0066 styling): a heading, a short styled
  fenced code block, a list, and one user bubble — the "deploy report" fixture from
  `e2e/spikes/web/explore-design-review.ts` is already shaped right.
- **Real-looking numbers**: non-zero token counts and a plausible session cost
  (e.g. `48.2k in / 12.7k out · $0.86`) — the review captures all read `$0.00`, which
  screams staged-demo; the mock provider's `inputTokens`/`outputTokens` per turn make
  realistic totals scriptable.
- **No raw UUIDs in frame** (post-DH-0066 short labels), `Live` connection pill visible,
  composer visible at the bottom so the interactive nature is obvious.
- **What must NOT be in frame**: a bare hello-world exchange, empty transcript panes,
  `$0.00 / 0 tok` zeros, `WAITING for just now` (fixed by DH-0066), or a lone agent with
  no tree — every one of these appears in today's overnight captures and is exactly what
  the hero must not look like.
- Given the TUI, when a secondary shot is wanted (nice-to-have, not gating), then a
  smaller TUI capture (post-DH-0065 styling, tree view with connectors and colored
  statuses) placed beside the run-modes table, showing the same session from the console —
  reinforcing the one-binary/two-clients story.

### As a maintainer, I want the hero reproducible, not a lost one-off

- Given the staging, when captured, then it is produced by a committed script (pattern:
  `e2e/spikes/web/explore-design-review.ts` — mock provider + scripted turns + Playwright
  screenshot at a fixed 1440x900 viewport), so the hero can be re-shot after any visual
  change with one command.
- Given UI drift, when DH-0065/DH-0066 (or later visual work) land, then re-running the
  script refreshes the hero — stale screenshots are worse than none.

### As a reader, I want a touch of visual identity beyond the screenshot

- Given the README title, when rendered, then carry the existing ◆ brand mark + wordmark
  (the web UI already owns this mark in `.brand::before`) — a full logo design is out of
  scope; consistency with the product's own chrome is the bar.
- Given the repo, when viewed, then standard shields (CI status, npm version, license MIT)
  under the title — conventional, and their absence reads unmaintained. (CI badge
  requires the public repo URL — confirm with the owner at implementation time.)

## Functional Requirements

- README stays the Prompt domain's (`README.md` — Iris) per CLAUDE.md §3; the staging
  script lands under `e2e/spikes/` (E2E-owned pattern, not gate-affecting — no `.test.`
  suffix).
- Images are committed binaries: keep them lean (PNG, ~1440px wide, <400KB each if
  possible) — no external image hosting (air-gap-friendly repo, and GitHub camo caching
  makes external hosts flaky).
- Alt text on every image; the hero must not be the sole carrier of any information (the
  mode matrix and feature text already cover the content — the hero illustrates, it does
  not document).

## Assumptions

- DH-0065/DH-0066 land first; this ticket's `depends_on` encodes that. If the owner wants
  a screenshot sooner, the current dark-mode web UI is presentable-but-flawed (unstyled
  code blocks visible) — the review recommends waiting.
- No trademarked or real-company content in the staged transcript (the "deploy report"
  fixture is fictional infrastructure — keep it that way).

## Risks

- Staged-but-real is the standard to hold: everything in frame must be actual rendered
  product output driven through the real binary and mock provider — no image editing
  beyond cropping, or the hero becomes a lie the first user notices.
- Committed PNGs bloat repo history if re-shot frequently — acceptable at 2 images;
  revisit only if the count grows.

## Open Questions

- One combined hero (web UI with TUI inset) vs. two separate images — owner taste; review
  recommends web-only hero + optional TUI secondary further down.
- Should the hero show a `failed` agent at all, or is all-green more appealing? Review
  recommendation: yes, include one — the red/green contrast demonstrates the observability
  story, and all-green looks like a mockup.

## Notes

> [!NOTE]
> Filed by the architect-on-call (Fable) from the 2026-07-16 design/UX review. Evidence:
> `README.md` (no imagery; line ~326 "No logo or wordmark yet"), overnight web captures
> (all `$0.00`/light-mode/sparse — counter-examples for the hero), and the fresh dark-mode
> captures from `e2e/spikes/web/explore-design-review.ts` showing the palette is
> hero-worthy once DH-0066's Markdown styling lands.

> [!NOTE]
> 2026-07-16: finished and ran `e2e/spikes/web/hero-screenshot.ts` (found already drafted,
> uncommitted, from a prior blocked attempt). Two blockers along the way, both fixed:
> - The spike hung indefinitely on the first turn — root-caused to `e2e/support/
>   mock-provider.ts` still serving non-streaming JSON responses after DH-0044 made
>   `stream: true` mandatory on both real provider adapters (the exact gap DH-0112 already
>   tracks). Fixed the mock to emit real SSE streams, reusing the event-construction pattern
>   from `src/agent/runtime.test.ts`'s `sseMessageResponse()`. `bun test src` unaffected
>   (1959 pass, 100% coverage held). Left follow-up notes on DH-0112 for the e2e assertions
>   this newly unblocks/breaks (mostly stale `callCount` expectations, plus one real gap in
>   `consumeAnthropicStream`'s malformed-response handling worth its own ticket) — out of
>   this ticket's scope, not blocking the hero.
> - Once streaming worked, a spawned sub-agent still mid-first-turn showed `waiting` (amber)
>   instead of `running` (blue) in the web UI — `src/agent/loop.ts` never emitted an initial
>   `agent_status: "running"` for a freshly spawned sub-agent, so the web client's
>   `ensureAgent` default (`waiting`) stood until the turn resolved, contradicting the style
>   guide's own definition of `waiting` ("idle, awaiting input/dispatch" — a dispatched,
>   in-flight sub-agent is neither). Fixed by emitting `agent_status: "running"` (+ matching
>   JSONL `status_change`) right after `agent_spawned`, scoped to sub-agents only
>   (`parentAgentId !== null`) so root's separately-governed `rootStatus` state machine is
>   untouched. `bun test src` unaffected (1959 pass, 100% coverage held, all 7 previously
>   order-dependent `find()`-first-`agent_status` assertions still pass since they're root-
>   scoped).
> - Also fixed the hero script itself: root's background fan-out wakes it once per completed/
>   failed sub-agent, and the script only had one scripted follow-up turn — the exhausted-
>   turns fallback repeated it verbatim, rendering as three duplicate assistant bubbles.
>   Added two short acknowledgment turns (one per real wake-up) and scrolled the transcript
>   pane back to the rich-Markdown deploy report before capture (a fresh message auto-scrolls
>   to the bottom).
> - Captured `docs/media/hero-web-dark.png` (129KB) and `-light.png` (126KB), both under the
>   400KB budget. Verified in frame: 5-agent tree (root + 3 children + 1 grandchild) with all
>   four status colors (blue running / amber waiting / green done / red failed), the deploy-
>   report Markdown (heading, bold/italic, nested list, ordered list, blockquote, fenced
>   `typescript` code block, link), a user message bubble, non-zero realistic token/cost
>   totals ($0.45 session total, no `$0.00`), short non-UUID sidebar labels, the `Live`
>   connection pill, and the composer.
> - Updated `README.md`: `<picture>`/`#gh-dark-mode-only`-equivalent (`prefers-color-scheme`
>   media queries, since GitHub's own `#gh-dark-mode-only` anchor trick only works for
>   anchor-referenced images, not inline `<picture>` — used the standards-based
>   `prefers-color-scheme` `<source>` pattern instead, which GitHub also honors) hero image
>   with alt text, added the ◆ brand mark to the H1, added npm-version and MIT-license
>   shields (left the CI badge as an explicit placeholder — needs the public repo URL, which
>   needs owner sign-off first, per this ticket's own Functional Requirements), and updated
>   "Status / deferred this round" to drop the stale "no logo/wordmark" line.
> - Gates: `bun run typecheck` clean, `bun test src --coverage` 1959/1959 pass at 100% new/
>   changed-code coverage, `bunx biome check` clean on every file this ticket touched (the
>   repo-wide `bun run lint` has 9 pre-existing failures in `.claude/skills/forked-subagent/`,
>   unrelated to this ticket). `bun run e2e` is not fully green — see the DH-0112 note above
>   for exactly which failures are pre-existing/newly-surfaced-but-out-of-scope vs. this
>   ticket's own work; none are in `e2e/spikes/` (not gated) or caused by files this ticket
>   owns beyond the two Core/E2E-domain fixes described above.
> Status → `verifying`. Closing needs sign-off that the loop.ts status-semantics fix and the
> mock-provider.ts streaming fix (both outside this ticket's original `e2e/spikes/` scope)
> are acceptable riders, plus the owner's call on the CI badge/public repo URL.
