# Dark Harness — Design System & Style Guide

**Owner:** Muriel (design crew lead). **Status:** living reference.
**Audience:** every agent shipping user-facing output — Mary (TUI), Susan (Web), Grace
(CLI/Core output), Radia (server output). Cite this doc by section in tickets and status
logs instead of re-deriving conventions each time.

This is the durable, reusable layer. Ticket-scoped mockups/spikes live in a ticket's Spile
sidecar (`tracking/DH-NNNN-slug/`), never here. When a decision is meant to be *reused
across surfaces*, it graduates here; when it's specific to one ticket, it stays in the
sidecar.

---

## 0. Why this exists (the north star)

`dh` is an agent harness — its entire reason to exist is *watching agents work*. The tool
must therefore **feel alive and deliberately designed**, not merely be correct. The owner's
brief, verbatim: *"I want this to actually bring delight and do flashy little pops."*

The recurring failure this role was created to end: narrowly-scoped polish tickets that get
satisfied to the letter while the tool still feels lifeless (see DH-0065, DH-0095, DH-0098,
DH-0099). The fix is a *shared* visual language so a "running" agent, a "checking…" model
probe, and a "reconnecting" socket all look like the same idea everywhere — and so no
implementer has to reinvent "what does pending look like" per subsystem.

**Three principles, in priority order:**

1. **One concept, one look, everywhere.** A status, a liveness state, or an entity (agent,
   model, session) must carry the same glyph + word + color family across TUI, Web, and CLI.
   Divergence is a bug, not a per-surface style choice.
2. **Liveness is mandatory for anything that waits.** Any operation that blocks on I/O
   (model probes, agent turns, SSE reconnect, server boot) shows a live pending state on a
   TTY and degrades gracefully off one. Silence-then-dump is the anti-pattern.
3. **Color is an accent, never the only signal.** Every status also carries a glyph and a
   word. Color-blind operators, non-TTY pipes, and log files must all read correctly with
   color stripped.

---

## 1. The status model (canonical — the single source of truth)

Five statuses, from `AgentStatus` in the contracts. Every surface renders the SAME five with
the SAME glyph, word, and color family. This table is law; deviations are tickets.

| Status | Word | Glyph | Meaning | Web (hex) | TUI/CLI (SGR) |
| --- | --- | --- | --- | --- | --- |
| running | `running` | `●` + spinner | actively working a turn | `--status-running` `#4f8cff` (cool blue) | `34` blue (bright `94` if available) |
| waiting | `waiting` | `●` | idle, awaiting input/dispatch | `--status-waiting` `#f5a524` (amber) | `33` yellow |
| done | `done` | `●` | finished successfully | `--status-done` `#35c469` (green) | `32` green |
| failed | `failed` | `●` | self-reported failure / error | `--status-failed` `#f2545b` (red) | `31` red |
| stopped | `stopped` | `●` | deliberately stopped (distinct from failed) | `--status-stopped` `#9a7bd1` (purple) | `35` magenta |

Rules:

- **Never color-only.** The glyph is always accompanied by the status *word* somewhere
  glanceable (badge on Web, word next to the glyph in the TUI tree, verb in CLI lines). This
  is already Web law ("status is never color-only", `styles.css`) and DH-0029/DH-0065 fixed
  `stopped` specifically because it silently fell back to gray on both surfaces.
- **Blue means running, everywhere.** The Web running dot is blue `#4f8cff`; the TUI must use
  blue (SGR 34/94), not cyan or green, for a running agent — cyan is reserved (see §3).
- **Purple means stopped.** Do not let `stopped` fall back to gray on any surface.

### 1.1 The pending/live state (the "flashy pop")

A *pending* state is distinct from the five statuses: it's the transient "I've started, no
verdict yet" shown while an operation is in flight. It has a fixed vocabulary:

- **Glyph:** an animated spinner. TUI/CLI use the braille cycle `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (already in the
  TUI). Web uses a soft pulse on the dot (already in `styles.css`).
- **Word:** present-progressive — `checking…`, `connecting…`, `starting…`, `thinking…`.
- **Color:** dim (`SGR 2`) on TUI/CLI; `--text-dim` on Web — pending is *subordinate* to a
  resolved verdict, never louder than it.
- **Resolution:** the pending row/line is **rewritten in place** into its resolved state
  (TUI/CLI: `\r\x1b[K` + resolved row; Web: dot transitions with the `--ease` curve). Never
  append the verdict below the pending line.
- **Non-TTY degrade:** off a TTY, skip the live pending state entirely and print the
  resolved result once. This is the DH-0099 contract, now generalized to every waiting
  operation. `process.stdout.isTTY === true` is the gate.

`dh doctor` (`formatDoctorPendingRow`, `runDoctor` in `src/cli.ts`) is the reference
implementation. `....`/`checking... (query sent)` should migrate to the canonical spinner +
`checking…` wording (see DH tickets).

### 1.2 The connection-state model (DH-0105 — canonical, shared TUI/Web)

The connection pill is the operator's only signal that a long unattended run is still
attached, and it previously spoke two different dialects (Web: `connecting`/`open`/
`reconnecting`/`closed`; TUI: `connecting`/`open`/`error`/`closed`, with no `reconnecting`
state at all). Both clients now share one four-state vocabulary, defined here and rendered
identically (modulo the §4 casing rule) on both surfaces:

| State | Meaning | Web label | TUI/CLI label | Color |
| --- | --- | --- | --- | --- |
| `connecting` | first connection attempt of the session, not yet succeeded once | `Connecting…` | `connecting…` | amber (pending, §1.1) |
| `live` | stream open, receiving events | `Live` | `live` | green |
| `reconnecting` | dropped after at least one prior success (or mid-retry after any failure), resuming via `Last-Event-ID` (DH-0024) | `Reconnecting…` | `reconnecting…` | amber (pending, §1.1) |
| `disconnected` | the client has stopped trying — a deliberate close, not a live retry loop | `Disconnected` | `disconnected` | red |

Investigation finding (the risk this ticket flagged): before this round, the TUI's `error`
state fired transiently after *every* failed reconnect attempt, and its `closed` state fired
after *every* clean stream end — in both cases the client's `while` loop immediately retried
again, exactly like the Web client's `reconnecting`. Neither TUI state was actually fatal;
relabeling `error` straight to a Web-style terminal state would have been wrong. Conversely,
neither client actually gives up and stops retrying on its own — both loop forever until an
external stop (TUI: `AbortSignal`; Web: `close()`). So `disconnected` is reserved for that one
real "given up" condition, and both the old TUI `error` and the old TUI `closed` (as well as
the Web's failure-driven retry scheduling) map to `reconnecting`. `src/tui/sse-client.ts` was
extended (previously it had no reconnect-vs-initial-connect distinction) to mirror the Web
client's `lastEventId`-presence check so `connecting` only ever describes the true first
attempt of a session.

`reconnecting` is always amber and animated (braille spinner on TUI/CLI per §1.1, CSS pulse
on Web) — never red — since it is a normal, non-alarming state per DH-0024's documented
resume story. `disconnected` is red on both surfaces. A word always accompanies the dot/pill
on both surfaces (§0 principle 3) — TUI shows the label word inline next to the colored pill
text, Web shows it as the pill's own text content.

---

## 2. Color & typography reference

### 2.1 Web (authoritative palette — `src/web/client/styles.css :root`)

The Web palette is the richest and is the **source of truth for hue intent**; other surfaces
approximate it within their capabilities.

- Surfaces: `--bg #0b0d12`, `--panel #12151c`, `--panel-raised #171b24`.
- Borders: `--border #232838`, `--border-strong #2f3648`.
- Text ramp: `--text #e7e9ee` → `--text-dim #8b93a7` → `--text-faint #5b6478`. Three tiers,
  used deliberately: primary content, secondary/labels, tertiary/decoration.
- Accent (brand): `--accent #f5a524` (amber) — the single brand hue; used for the app
  wordmark, focus, and the `waiting` status. `--danger #f2545b`.
- Status: see §1 table.
- Spacing scale (use these tokens, don't hardcode px): `--space-1 4` · `-2 8` · `-3 12` ·
  `-4 16` · `-5 24`. Radii: `--radius-sm 6`, `--radius-md 10`.
- Fonts: `--font-ui` (system sans) for chrome, `--font-mono` for transcript/code/ids/tokens.
- Motion: `--ease cubic-bezier(0.2,0.7,0.3,1)`; restrained and purposeful — a soft pulse on
  running, a fade-in for new content. No gratuitous animation.
- **Light theme** mirrors the structure via `prefers-color-scheme: light` — every new color
  must define both themes.

### 2.2 TUI/CLI (SGR only)

Terminals get the 16-color SGR set, no truecolor, no background colors, no OSC — this is the
DH-0056 allowlist enforced in `src/tui/markdown-ansi.ts`. Canonical usage:

- **Reset** `0`; **bold** `1` (emphasis, app name, verdict words); **dim** `2` (secondary
  text, pending, footer hints, code gutters, separators); **italic** `3`; **underline** `4`
  (h1, links).
- **Foreground:** `31` red (failed/error), `32` green (done/pass), `33` yellow (waiting +
  the amber-accent role + user gutter), `34` blue (running), `35` magenta (stopped), `36`
  cyan (**reserved**: headings h2+, structural/informational chrome — NOT a status).
- Every styled row is **reset-terminated and self-contained** — no style leaks across rows
  into header/footer (DH-0065 style-bleed defect; keep the regression tests).
- Amber/accent has no exact SGR; `33` yellow carries the accent role in the terminal. That's
  why the user gutter and `waiting` share yellow — accepted approximation.

### 2.3 Cross-surface hue map (memorize this)

| Role | Web | TUI/CLI |
| --- | --- | --- |
| brand / accent / waiting | amber `#f5a524` | yellow `33` |
| running | blue `#4f8cff` | blue `34` |
| done / success | green `#35c469` | green `32` |
| failed / error | red `#f2545b` | red `31` |
| stopped | purple `#9a7bd1` | magenta `35` |
| structure / headings | `--text-dim`/borders | cyan `36`, dim `2` |

---

## 3. Glyph & iconography vocabulary

One glyph per concept, shared across surfaces where the medium allows:

| Glyph | Meaning | Where |
| --- | --- | --- |
| `●` | status/health dot — color = status per §1; **canonical ok/live green is `STATUS_TOKENS.done.webHex` `#35c469`** (DH-0225), the same green as an agent's `done` status, on every surface including the CLI startup header's health dot — never `BRAND.harnessGreen` `#9ECE6A` for this glyph. `BRAND.harnessGreen` stays in play for non-status-dot brand flourishes (wordmark gradient, `✓ ready` checkmark, `dh:` log prefix) — those are decorative brand accents, not the shared status vocabulary, so they're unaffected by this call. | TUI tree, Web tree/panel, CLI startup header |
| `⠋⠙⠹…` (braille) | live/pending spinner | TUI/CLI |
| `⚙` | a tool call or sub-agent spawn in a transcript (dim, subordinate) | TUI/Web transcript |
| `>` | user turn / input prompt gutter | TUI (`> `, bold yellow), CLI input |
| `├─ └─ │` | tree connectors | TUI tree, `dh logs` (`formatNode`) |
| `·` (middot) | inline separator in stat strips (`120 in · 340 out · $0.01`) | Web, and TUI/CLI where stats appear |
| `—` (em dash) | "no value" placeholder (e.g. unpriced cost) — never `$0.00` | all surfaces |

Notes:
- `dh logs` already draws `├─/└─/│`; the interactive TUI tree must not look worse than the
  offline dump (DH-0065). Connectors are the house tree style everywhere.
- `⚙` for tool/spawn markers is dim (`SGR 2` / `--text-dim`) and visually subordinate to
  prose output — observing the agent's *words* stays primary; the machinery is annotation.

---

## 4. Terminology (write these words, not synonyms)

Consistent nouns/verbs across help text, labels, docs, and logs:

- **agent** (root agent, sub-agent) — never "task", "worker", or "job" in user-facing copy.
  (`--job` the flag is fine; a running unit is an *agent*.)
- **session** — one `dh` run; identified by a **session id**; logs live under `.dh-logs/<id>`.
- **model** — a configured entry in `dh.json`'s `models` (has a `name` + provider + model id).
- **status** — one of the five in §1. Use those exact words.
- **status casing (DH-0100 decision):** each surface keeps its current, now-*intentional*
  casing — lowercase (`running`, `waiting`, `done`, `failed`, `stopped`) in the TUI and CLI
  (`dh logs`), matching their raw/log character, and Title Case (`Running`, `Waiting`, …)
  only in the Web badge, a legitimate Web UI idiom. This is a deliberate per-surface style
  choice, not an inconsistency to fix — the real divergence this ticket closed was *color*,
  not casing. `dh logs`' `running (no terminal event seen)` qualifier is a real offline-log
  distinction (the live surfaces can't detect a missing terminal event) and stays as-is; it
  is not a third status vocabulary. The same per-surface casing rule applies to the §1.2
  connection-state words (DH-0105): lowercase (`connecting…`, `live`, `reconnecting…`,
  `disconnected`) on TUI/CLI, Title Case (`Connecting…`, `Live`, `Reconnecting…`,
  `Disconnected`) on Web — one shared word list, cased per surface, not two vocabularies.
- **turn** — one user/assistant exchange unit in a transcript.
- **short id** — the display form of an agent id (`shortAgentId`, `src/web/client/format.ts`).
  **Never** show a full 36-char UUID in human chrome — use `model · short-id` (DH-0065). This
  applies to the `--server` activity feed too (currently prints full UUIDs — a gap).
- **tokens / cost / elapsed (DH-0104 — canonical, shared TUI/Web/CLI)**: three surfaces
  (TUI, Web, `dh logs`) once rendered the same value three different ways. The rules below
  are the single source of truth; `src/format.ts` implements them once and `src/tui/
  render.ts`, `src/web/client/format.ts`, and `src/server/log-analysis.ts` all import from
  it (rather than each keeping its own copy) so a future edit to one surface can't silently
  re-diverge from the others. Stat strip format stays `<in> in · <out> out · <cost>`.

  - **Cost**: known cost renders `$0.00`-style at **2 decimal places**, with `<$0.01` for a
    tiny nonzero amount (e.g. `$0.0031`) rather than rounding it to `$0.00`, which would
    read as free. **Unknown** cost (the model has no pricing configured) renders `—` (em
    dash) — **never** `$0.00`, which misrepresents an unpriced model as free — and is
    excluded from any total (a total with at least one known-cost contributor still sums
    the known figures; it only reads as `—` if *no* contributor has a known cost). This
    2-dp rule applies to every **interactive** view: the TUI's tree/root/agent views and
    Web's sidebar/strip/detail.
    - **`dh logs` exception**: the CLI's `dh logs` audit-dump tool is a deliberate,
      owner-confirmed exception that keeps **4 decimal places** (`$0.0456`) instead of 2 —
      an operator inspecting raw session logs may care about sub-cent differences the 2-dp
      interactive views round away. It still follows the unknown-cost rule (`—`, never
      `$0.00`). This is a permanent two-tier rule, not a divergence to converge away.
  - **Tokens**: which of two forms applies is a property of the *context*, not the
    surface — apply the same rule on every surface:
    - **Glanceable chrome** (TUI tree rows, the TUI header's session-totals strip, Web
      sidebar badges and the session-totals strip) uses the **compact** `12.3k`/`1.2M`
      form — density matters more than precision when it's one of several things on a row.
    - **Detail/log contexts** (`dh logs`, the TUI's per-agent detail view, Web's per-agent
      detail header) use the **full comma-grouped** `12,345` form — the operator is reading
      closely enough here that precision matters more than density.
  - **Elapsed**: one rule everywhere, no two-tier split (unlike cost/tokens) — spaces
    between unit groups and a `"just now"` affordance for sub-second durations:
    `just now`, `42s`, `3m 12s`, `1h 05m`. `dh logs`' `formatDuration` uses this same
    shared elapsed formatter (it does **not** get its own exception the way cost does).
- CLI voice: user-facing lines are prefixed `dh: ` and written as plain, lowercase-leading,
  full sentences. Keep it; but see §5 for adding structure/hierarchy on top.

---

## 5. CLI output conventions (the biggest current gap)

Today nearly all CLI output is undifferentiated `dh: <sentence>` lines with no color, glyph,
or hierarchy — the one exception is `dh doctor` (DH-0099). `init`, `--version`, `--dry-run`,
the `--server` startup block, and the activity feed are all flat plaintext. The felt result:
correct, lifeless. Conventions to close that:

- **Multi-line command output gets a shape**, not a wall of equal lines: a result headline
  (with a status glyph — `✓` success / `✗` failure / `●` status), then indented supporting
  detail, then a clearly-set-off **next step** callout. Wrap to terminal width (DH-0098).
- **Verdict glyphs** (TTY-gated, color per §1): `✓` green for success outcomes, `✗` red for
  failures, dim for secondary notes. Reuse the doctor color gate everywhere.
- **The `dh: ` prefix stays** for grep-ability/log identity, but a headline line may lead
  with a glyph after the prefix (`dh: ✓ wrote dh.json`).
- **Liveness for anything that waits** (server boot, provider construction in `--dry-run`,
  model probes) per §1.1 — spinner on TTY, once-line off TTY.
- **Short ids, not UUIDs**, in the activity feed and any agent reference (§4).
- **Startup blocks read as a panel:** headline (what's running + where), then the connect
  hint, then the security-posture note visually marked as a caution (dim/yellow), not just
  another sentence in the stack.

---

## 6. Interaction conventions

- **Keybindings** (TUI, `docs/tui-keybindings.md`): arrow navigation, Enter to send/open,
  Left/Esc to go back, Ctrl-C quits. Only the root agent is interactive; sub-agent views are
  observation-only ("coordinator holds the conversation"). Any new key must be documented
  there and, ideally, hinted in the footer.
- **Footer hints** recede: dim brackets/labels (`SGR 2`) so they sit behind content.
- **Reconnect** (both surfaces): a visible, non-alarming pending state (`connecting…`/
  `reconnecting…`, spinner/pulse) using the §1.1 vocabulary and the §1.2 connection-state
  model — then silent catch-up via `Last-Event-ID`; never a full reset of the view
  (web-ui-guide.md, DH-0024).
- **Focus & selection** are always visible (TUI selection highlight; Web focus ring in
  `--accent`). Never rely on color alone for the selected row — also a marker/indent.
- **Motion is purposeful:** running-pulse and content fade-in only. No spinners that outlive
  their operation, no decorative animation.

---

## 6.1 Component architecture conventions (React/Web, Ink/TUI — added 2026-07-17, DH-0133)

With DH-0133's migration of Web to React and TUI to Ink, both surfaces become component
trees (different renderers, not a shared component library — see DH-0133's Notes on why
components themselves can't be shared across DOM and terminal host environments). Two
conventions apply to both trees going forward:

- **Design tokens are a shared module, not per-surface constants.** Status/connection
  color+glyph+word (§1/§1.2/§2.3) is imported by both React and Ink components from one
  module (`src/design-tokens.ts`, DH-0137) rather than each surface re-declaring its own
  `STATUS_COLOR`/`STATUS_STYLES`-shaped record. This mirrors the precedent `src/format.ts`
  already set for numeric formatting (DH-0104) — a genuinely cross-surface constant belongs
  in one root-level `src/` module both `src/web/client/` and `src/tui/` import, not
  duplicated by hand. This does **not** extend to spacing/typography — Web's `--space-*`/
  `--radius-*`/font tokens stay CSS-only; a terminal has no analogous unit and inventing a
  shared one would be speculative, not a real need.
- **Reserve slots for known-upcoming content before it's designed.** When a ticket is known
  to be queued right behind a structural change (as DH-0121/0122/0124/0125 were queued
  behind DH-0133), the structural change's component tree should reserve an inert slot for
  it — a component that mounts, renders zero visible output/rows, and takes typed props —
  rather than requiring the tree to be re-shaped again when the follow-up ticket lands. The
  slot's existence and "renders nothing until populated" behavior is testable and owned by
  the structural ticket (DH-0135/DH-0136 reserve `<AppHeader>`/`<Header>`/`<StatusRow>` for
  DH-0122/DH-0124/DH-0125); the slot's *content* stays the follow-up ticket's own design and
  implementation work. Don't over-apply this — only reserve for asks that are already a real
  ticket on the books, not speculative future features (see MEMORY.md "defer speculative
  work").

---

## 6.2 The brand-launch moment — one brand object, per-surface idiom (added 2026-07-20, DH-0245/DH-0248)

Every interactive surface earns a real branded launch moment (the wordmark + status the
operator sees on start), but it is realized **in that surface's own native idiom** — do not
port one surface's *mechanism* to another. What is shared is the brand *object*, never the
delivery mechanism:

- **Shared across surfaces:** one mark (the DH monogram, `logo.svg`/`<LogoMark>`), one
  "Dark Harness" wordmark, one green→cyan gradient — `BRAND.harnessGreen #9ECE6A` →
  `BRAND.signalCyan #7DCFFF` (`src/design-tokens.ts`; the exact stops `LogoMark`'s SVG
  `linearGradient` uses; Web mirrors them as `--brand-grad-start`/`--brand-grad-end`). A user
  moving between the TUI and the Web UI must see the *same* brand object, not two lookalikes
  with different greens.
- **Per-surface mechanism, chosen for that surface's constraints, NOT copied:**
  - **TUI (DH-0245):** a *synthetic scrollable leading transcript entry*, forced by a
    TUI-specific bug — Ink's alt-screen clear wipes any fixed pre-mount banner, so the only
    way to make Header A2 persist and reappear on scroll-to-top was to make it real transcript
    content.
  - **Web (DH-0248):** a *fixed, non-scrolling masthead* in the top grid band. The Web has no
    alt-screen wipe to work around, and a persistent masthead is the better outcome (stays
    glanceable all session, vs. the TUI's banner hiding once you scroll down). Web must **not**
    push the brand moment into the transcript scroll region to mimic the TUI — that would be
    porting a bug-workaround as if it were the design.
- **Rule:** when a "brand moment" ticket exists for a new surface, share the palette/mark/
  wordmark; decide placement + persistence from *that* surface's real constraints. The reason
  one surface scrolls its header and another pins it is not inconsistency — it's each surface
  answering the same intent (a persistent brand moment) correctly for its own medium.

---

## 8. README / repo-front conventions (added 2026-07-19, DH-0227/DH-0228)

The repo's front door — the README hero and the external social-preview card — is a designed
surface, not an afterthought. Two durable rules, set when the owner flagged the hero as
sitting too low ahead of showing the project to people:

- **First-screenful order is: mark → name → one-line tagline → badges → product screenshot.**
  Long-form rationale (why-this-exists essays, security posture, feature prose) lives *below*
  the product shot. The single most persuasive element a repo has is the screenshot of the
  thing running; it must be reachable without scrolling past philosophy. A multi-line bold
  "hook" paragraph is **not** a tagline — the tagline is one sentence
  (`Point dh at a repo and an instructions file, and it works the job unattended.`). This
  order is enforced by a block-order assertion in the README-sync test family
  (`src/prompt/`), so a future edit can't silently re-bury the screenshot. (DH-0227.)
- **The on-page hero and the external social card share one mark, one tagline, one palette.**
  The GitHub social-preview card (1280×640, `docs/media/social-preview.{svg,png}`) is
  near-black `#0b0d12`, with the *actual* `logo.svg` monogram (its own green→cyan gradient,
  never recolored) + the full "Dark Harness" wordmark in `--text` as the dominant elements,
  the shared one-line tagline in `--text-dim`, and — at most — a recessive agent-node-graph
  motif (status-colored dots, wire-gray lines, low opacity, in the corners) as background
  texture. No feature bullets, no cropped UI chrome, no retired `◆` diamond. The card is a
  static checked-in asset (SVG source + rendered PNG), regenerated by hand only when the
  brand changes — same cadence as `logo.svg`, not a build-pipeline artifact. Uploading it to
  GitHub Settings → General → Social preview is a manual owner action, outside ticket scope.
  (DH-0228.)

---

## 7. How to use this doc

- **Implementers:** cite the section (`per style-guide §1`) in status logs; don't re-derive.
- **Ticket authors (me):** every UX ticket references the relevant sections and flags any
  proposed *addition* to the canonical tables here as a design-doc change (which I own).
- **Extending the SGR allowlist or the palette** is a real design decision — route through
  me, and if it touches the wire/contract (e.g. a new SSE event for tool-call visibility),
  it's a `src/contracts/` change needing architect sign-off per CLAUDE.md §6.
- This doc changes by dated amendment when a convention genuinely evolves — not silent
  rewrite. Keep the status table (§1) and hue map (§2.3) stable; churn there ripples wide.
