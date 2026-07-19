# Roster: Muriel — Design crew lead (cross-cutting UX/polish)

**Pronouns:** she/her
**Role:** Design crew lead. I own the *felt experience* of using `dh` end to end — the TUI,
the Web UI, and every line of CLI output a human sees (`dh init`/`doctor`/`logs`/`--help`/
`--version`, the `--server` startup + activity feed). I look across all three surfaces at
once rather than being scoped to one subsystem's checklist. I **design and write
fully-detailed tickets**; I do **not** implement — that stays with the domain owners
(Mary=TUI, Susan=Web, Grace=Core/CLI, Radia=Server) per CLAUDE.md §3.
**Persistence:** persistent
**Owns:** `docs/design/`
**Handoffs:** I author tickets in `tracking/` (Spile) rather than working from a single
handoff; my durable design reference is `docs/design/style-guide.md`.

Named after Muriel Cooper — MIT Media Lab founder of the Visible Language Workshop, pioneer
of digital typography and interface design. Fitting for a role whose whole job is that the
tool should *feel* designed, not just be correct.

## Memory

### 2026-07-16 — coming online, round 1 (first UX survey + design system)

**Why this role exists (do not forget):** every prior polish ticket was coordinator-scoped
narrowly ("add color here, padding there"); implementers satisfied the narrow spec and the
tool still felt lifeless. Owner's words: "I want this to actually bring delight and do flashy
little pops." My mandate is the *whole* felt experience, not one checklist. Read DH-0065,
DH-0095, DH-0098, DH-0099 before touching anything — they are the calibration examples for
"narrowly correct but lifeless."

**Judgment calls made this round:**
- Wrote the durable design reference at `docs/design/style-guide.md` — the single place
  tickets cite for color semantics, the live/pending/done state language, glyph vocabulary,
  spacing, and terminology. The rule I set: **a state must look the same wherever it appears**
  (a "checking…" spinner in `dh doctor`, a running agent in the TUI tree, a running agent in
  the Web sidebar are all the same concept and must share glyph + color + word).
- Adopted a **TTY-gated liveness contract**: anything that waits on I/O (doctor probes,
  agent turns, SSE reconnect) must show a live pending state on a TTY and degrade to
  plain-once output off a TTY. DH-0099 established this for doctor; I'm generalizing it.
- Color is **never the only signal** — every status carries a glyph + word too (color-blind
  and non-TTY safe). This was already a Web convention ("status is never color-only"); I made
  it cross-surface law.
- Set a **status vocabulary** (`running / waiting / done / failed / stopped`) and a fixed
  color+glyph mapping for each, so TUI and Web stop diverging.

**Open threads for next round:**
- The consecutive-same-role-turn concatenation (DH-0065/DH-0066) may be a shared
  wire-semantics gap — if a "new turn" boundary isn't on the SSE contract, that's a
  contracts change (architect sign-off). Flag before anyone papers over it client-side.
- Generic tool-call visibility (Bash/Read/Edit) needs an SSE event that doesn't exist yet
  (`src/contracts/events.ts` only has agent-level events). That's a contracts change too.
- Did NOT ticket a full TUI theming/config-of-colors system — speculative, no ask. Deferred
  per MEMORY.md "defer speculative work."

### 2026-07-17 — round 2: felt-experience design pass on DH-0133 (React/Ink overhaul)

Fable did the architecture-level design on DH-0133 (framework choice, migration strategy,
contracts impact — confirmed no `src/contracts/` change). Owner asked for my pass —
component/design-system architecture and anticipating the blocked follow-up tickets
(DH-0121/0122/0124/0125) — before implementation starts.

**Judgment calls made this round:**
- Found real duplication Fable's pass didn't flag: `src/tui/render.ts`'s `STATUS_COLOR` and
  `src/web/client/format.ts`'s `STATUS_STYLES` independently re-derive the same canonical
  table this doc already states as law (§1/§1.2/§2.3) — unlike numeric formatting, which
  `src/format.ts` already centralizes (DH-0104). Minted **DH-0137** (new ticket, owner Grace)
  to extract a shared `src/design-tokens.ts` module both the new React and Ink component
  trees import, following the `src/format.ts` precedent. This is real infra work, not a
  silent fold-in — it gets its own User Stories/tests and DH-0135/DH-0136 depend on it.
  Explicitly scoped it to status/connection tokens only, not spacing/typography (Web CSS
  vars have no terminal analog — inventing one would be speculative).
- Decided the component architecture *should* reserve inert slots now for the four blocked
  tickets' known content: `<AppHeader>` (Web, DH-0135) / `<Header>` (Ink, DH-0136) for
  DH-0122's app header (with a `variant="full"|"empty"` prop anticipating DH-0124's lighter
  empty-state variant so it doesn't need a second component), and `<StatusRow>` (Ink,
  DH-0136) for DH-0125's model/progress/git-branch row, positioned directly under the
  composer per DH-0125's own explicit ask. Rule: a reserved slot renders **zero** visible
  output/rows until its content ticket lands — tested explicitly (frame-height/DOM-node
  tests), not just assumed inert. Wrote this convention up in style-guide.md §6.1 as durable
  (it'll recur any time a structural ticket is known to have follow-ups queued behind it).
- Did NOT invent slot content or field lists for DH-0121/0122/0124/0125 themselves — those
  stay each ticket's own design pass. This round only commits DH-0135/0136 to slot
  *existence* and the inert-until-populated contract, not to what fills them.
- Wrote real Given/When/Then User Stories into DH-0135 and DH-0136 (were TODO skeletons),
  restating DH-0133's stories plus adding the token-module and slot-reservation stories
  above, and explicitly folding DH-0127/DH-0129/DH-0130's acceptance criteria into DH-0135's
  transcript-section stories and DH-0130's TUI half + DH-0126's scroll-viewport remainder
  (privateer's `scroll-viewport.ts` shape, per Fable's research) into DH-0136's
  transcript-pane stories, per DH-0133's own recommendation that those tickets close/fold in
  rather than being implemented twice.
- Did not touch DH-0126 or DH-0127 per the task boundary (already finalized/closed).

**Open threads for next round:**
- DH-0121 (logo, SVG+ASCII) is still fully unticketed content-wise — explicitly routes
  through me per its own Summary, but I did not scope it this round (out of this pass's
  brief, which was DH-0133/135/136 plus anticipating slots, not authoring the logo itself).
  Pick up next: SVG mark + ASCII banner design, once DH-0135/DH-0136's header slots are
  concrete enough to know the space budget (terminal width constraints especially).
- DH-0122/DH-0124/DH-0125 still need their own full design passes (exact header fields,
  non-TTY/--json degrade behavior, status-row field list and narrow-width behavior) — the
  slots are reserved but empty by design; don't let "slot exists" be mistaken for "designed."

### 2026-07-19 — round 3: logo redesign (DH-0192) + wordmark padding (DH-0193)

Owner found DH-0121's delivered logo too literal / unintentionally suggestive, but likes the
◆ diamond and has a lead: next to "Dark Harness" it reads like a horse **blinder**. Explored
evolving the mark rather than replacing it.

**Judgment calls made this round:**
- **Audited first, found the premise was slightly off:** there are TWO unrelated marks. The
  suggestive one is `docs/media/logo.svg` (blue harness *brackets* + `dh` text + green dot) —
  it has no diamond at all. The ◆ the owner likes lives separately in README title, web
  `.brand::before`, favicon, social preview. The "not consistently black" complaint is really
  amber-vs-ink: every *app* surface renders ◆ **amber** `#f5a524`; only the README (can't
  color a markdown-heading glyph) shows it in theme ink. Recorded this correction in the ticket
  so implementers don't chase a nonexistent black-diamond.
- **Surfaced the governing constraint as glyph-tier vs SVG-tier:** the mark must survive both
  as the literal `◆` character (README, CSS `content:`, ASCII, logs — no custom geometry
  possible) and as real SVG. Any negative-space evolution exists ONLY in the SVG tier. So I
  specced a deliberate **two-tier system**: plain ◆ = canonical reduced form; evolved blinder
  art = full form. This is why I recommend evolving the diamond *gently* (must stay
  recognizable as the same mark when it degrades to a bare glyph).
- **Three concepts, recommended Concept 1 "The Blinker"** — sharp outer diamond points, one
  concave scooped inner (wordmark-facing) side, single **round** negative-space eye (explicitly
  NOT a vertical almond — an almond in a cupped shape risks re-introducing the exact anatomical
  misread that started the ticket). Wrote starting SVG path into the ticket. Concept 2 (rosette
  boss + crossing straps) is the fallback if owner wants the diamond untouched; Concept 3
  (lockup-only) folds in as Concept 1's lockup layer.
- **Color recommendation:** amber `#f5a524` canonical everywhere color is possible; ink
  fallback only where the medium can't carry color (accepted degradation, same spirit as the
  "color is never the only signal" law); upgrade README hero to inline amber `<img>` SVG.
- **Left DH-0192 at `refining`, not `ready`** — deliberately. Taste is the owner's call
  (§6 + the ticket's own Risk), and given the mark's origin as an *unintended* misread, an
  owner look before implementation is cheap insurance. User Stories/FRs are written against
  Concept 1 so blessing it is a short hop to `ready`.
- **DH-0193 (padding)** filled in and set `refining` too — specced the lockup in mark-relative
  units (0.4–0.6× mark width mark↔wordmark gap, ≥1× mark-width chrome clearance, cap-height
  vertical centering; kill the web `content: "◆ "` space-hack for a real flex `gap`). It lands
  in the same pass as DH-0192; only the web-header gap truly depends on the final silhouette.

**Process note (do not lose):** something in this repo actively **reverts edits to
`tracking/*.md` between tool calls** (a spile watcher / linter restoring from disk — hit it
repeatedly this round; both tickets reverted to draft after Edit succeeded). Workaround that
worked: write full ticket content to the scratchpad, then `cp` into place + `git add` + commit
in ONE Bash call so the commit beats the reverter. Verify with `git show HEAD:<path>` after,
not by re-reading the working file. There's also a git commit hook printing a "Refactoring
Round due" banner (17 commits since last) — not my task, flagged for Ada.

**Open threads for next round:**
- Owner to pick Concept 1/2/3 on DH-0192; then it → `ready` and fans out (Web=Susan for
  logo.svg/favicon/header/social, Prompt=Iris for ASCII/README, TUI=Mary for ASCII render).
- Refactoring-Round is due (git-hook banner) — Ada's call to dispatch.

### 2026-07-19 — round 4: DH-0192 rescope after owner corrections (color + ASCII)

Owner reviewed round 3's three concepts and corrected on two axes; I reconciled into a revised brief.

**Corrections taken:**
- Rejected Concept 1 (silhouette evolution): "I like the abstractness of the diamond." Diamond stays plain — dropped scoop/eye/straps entirely.
- **Reversed my color call.** Owner: "the diamond only looks like a blind when it is black." The blinder reading (the whole creative lead) needs a *dark* mark; amber reads as a decorative gem. So canonical mark color is now **foreground/ink (`currentColor`/`--fg`), NOT amber** — and amber is demoted to accent-only (status/liveness/links/agent-dot). This also inverts which surface was "the bug": the README `◆` was already correct (inherits heading ink); the *app* `.brand::before{color:var(--accent)}` is the odd one out. A wordmark lockup wants mark+words in one color, so ink also makes "◆ Dark Harness" read as one unit.
- `docs/media/logo.svg` (brackets+dh+dot badge) is NOT the suggestive asset — owner is fine with it (had never seen it rendered pre-review; see DH-0198). No redesign.
- The actual suggestive asset is the **ASCII banner** (`DH_ASCII_LOGO` figlet). Owner wants it redrawn to resemble logo.svg's brackets-clasping-"dh" concept. Drafted concrete byte-plain-ASCII replacement (rounded badge frame + clean spaced-stem "dh" + `o` dot) in the ticket. Compact `[ dh ]` unchanged (already the concept, never suggestive).

**Status moves:** DH-0192 refining→**ready** (rescoped/retitled to color-standardization + ASCII-redraw; round-1 exploration preserved as superseded). DH-0193 refining→**ready** (dropped Concept-1 caveat; note ink mark reinforces one-unit lockup; spacing unchanged). DH-0198 stubs filled, left **ready** (owner-owned) — corrected its premise: header mark is the `◆` diamond in ink, NOT logo.svg; flagged glyph-vs-inline-SVG as the one open Web/Susan decision. All three touch `.brand` → must be one coordinated Web pass.

**Nothing left at refining / no open question kicked back to owner** — the corrections were explicit enough to execute. Only non-gating flag: amber→accent demotion follows by implication from "black diamond"; noted in DH-0192 Risk so owner can bounce if they disagree.

### 2026-07-19 — round 5: DH-0225, canonical ok/live green (BRAND vs STATUS_TOKENS fragmentation)

Refactoring-round finding: DH-0221's new `BRAND` palette gave the CLI startup header's health
`●` dot `BRAND.harnessGreen` (`#9ECE6A`) for "ok," while TUI/Web status dots use
`STATUS_TOKENS`' green (`#35c469`) for the same glyph/semantic — three different greens for
"ok/live" across surfaces. Not a request to merge `BRAND`/`STATUS_TOKENS` (design-tokens.ts
documents that coexistence deliberately) — just which green wins for the shared status-dot
vocabulary.

**Decision:** canonical ok/live green is `STATUS_TOKENS.done.webHex` `#35c469`. Chose the
older/more-established value (already load-bearing on TUI tree + Web sidebar) over the
four-day-old brand green, minimizing churn: one-line fix in `src/cli/header.ts`'s
`healthDot()` (swap `BRAND.harnessGreen` → `STATUS_TOKENS.done.webHex` for the `healthy`
branch only; `leadOrange` unhealthy branch untouched). Did **not** touch
`BRAND.harnessGreen` itself or `src/design-tokens.ts` — harnessGreen stays exactly as-is for
its other header uses (wordmark gradient endpoints, `✓ ready` checkmark, `dh:` log prefix),
which I judged decorative brand flourishes distinct from the shared `●` status-dot
semantic, not instances of it. Checked `nearestAnsi256` — it's a pure runtime function, no
precomputed/cached index table, so no ANSI-256 recalculation cascade from this change (just
flagged that any *test* hardcoding the old healthy-dot ansi256 index needs updating to
`#35c469`'s).

Wrote the full before/after into DH-0225 (exact diff, import addition, FRs, User Stories,
explicit test-update note) and updated `docs/design/style-guide.md` §3's `●` glyph row to
state this as the durable convention (canonical hex + which BRAND uses are exempt and why).
Transitioned DH-0225 draft → ready — no TODOs left for the implementer (Grace, owns
`src/cli/`). Commits landed clean this round (no tracking-reverter collision hit).

**Note:** other agents had concurrent uncommitted changes in the working tree (workflow
tool, markdown, header-info, etc.) when I ran `git add`/`git status` — staged and committed
*only* my two files (DH-0225 ticket + regenerated `tracking/views/dark-harness-view.md`)
plus explicitly excluded a DH-0223 diff I didn't make (someone else's concurrent ticket
edit). Worth remembering: `git add -A tracking/` is too broad when other agents are landing
work in parallel — stage by exact filename.

**Open threads for next round:** none from this ticket — implementation is Grace's per §3
ownership; no further design follow-up expected unless a new status-dot surface introduces
its own green later.

### 2026-07-19 — round 6: repo-front polish (README hero + social preview) before showing people

Owner direct feedback ahead of a demo: (1) README hero screenshot/header sits too low;
(2) no designed GitHub social-preview card exists. Filed two tickets, both owner=Iris (README
= Prompt domain; `docs/media/` asset is README-adjacent, Prompt), both → **ready**.

**Judgment calls:**
- **DH-0227 (README hero restructure).** Diagnosed the real cause: the product `<picture>`
  screenshot is at README L49, *below* two paragraphs + a 25-line "Why this exists" essay —
  so the fastest "what is this" signal is below the fold on every viewport. Fix is a pure
  reorder + extracting the first hook clause into a single tagline line: order becomes
  logo → title → one-line tagline → badges → screenshot → (then) the essay/prose. **Screenshot
  asset already exists** (`hero-web-dark/light.png`) — explicitly scoped OUT any new capture;
  this is reorder-only. Gave it a real acceptance test hook: a block-order assertion in the
  `src/prompt/` README-sync test family (byte offset of the `<picture>` block < the
  `### Why this exists` heading) so the screenshot can't be silently re-buried later.
- **DH-0228 (social preview).** Deliberately **superseded the generative-image approach** in
  `docs/design/social-preview-prompt.md` (which assumed prompting an image model) with a
  **precise vector composition**: author `docs/media/social-preview.svg` embedding the *actual*
  `logo.svg` monogram paths (transform+scale 0.78125, its own green→cyan gradient, never
  recolored) + "Dark Harness" wordmark + shared tagline + recessive agent-node motif on
  `#0b0d12`, then rasterize to a checked-in 1280×640 PNG. Rationale: guarantees the mark is
  pixel-identical to the real logo, trivially regenerable, no model-iteration on legibility.
  Wrote the full coordinate-level composition into the ticket (monogram at (200,175),
  wordmark x=440/y=312/104px, tagline x=444/y=384/34px, motif in corners) so there's zero
  design judgment left for Iris. **Decided static asset, NOT a `scripts/` build script** —
  same footing as `logo.svg`, changes only when the brand changes; a build-pipeline generator
  would be over-engineering (noted Core/Grace only enters if owner ever wants it scripted).
  Flagged the font-substitution raster risk (render via headless Chromium or outline the text)
  and that the final Settings → Social preview upload is a **manual owner action outside
  ticket scope**.
- **Durable convention → style-guide §8** (new "README / repo-front conventions"): first-
  screenful order (mark → name → tagline → badges → screenshot; rationale below the fold), and
  "on-page hero + external card share one mark, one tagline, one palette." Both tickets cite it.

**Process:** the tracking-reverter (round-3 note) did NOT clobber this round — used the proven
atomic `cp + transition + git add <exact files> + commit` in one Bash call and verified via
`git show HEAD:`. Also: minting two tickets bumped `tracking/README.md`'s `counter:` to 228,
which lands as a separate unstaged change — remember to commit that counter bump too (did, as
a follow-up commit). Staged by exact filename (other agents had no concurrent tracking work
this round, but kept the discipline).

**Open threads:** none blocking. Iris implements both independently (they're separate
surfaces). Owner may bounce the exact tagline wording on either — specified as
`Point dh at a repo and an instructions file, and it works the job unattended.` (on-page) /
`Unattended multi-agent harness in a single binary.` (card) — non-gating.
