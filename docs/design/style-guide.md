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
| `●` | agent status dot (color = status per §1) | TUI tree, Web tree/panel |
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
  is not a third status vocabulary.
- **turn** — one user/assistant exchange unit in a transcript.
- **short id** — the display form of an agent id (`shortAgentId`, `src/web/client/format.ts`).
  **Never** show a full 36-char UUID in human chrome — use `model · short-id` (DH-0065). This
  applies to the `--server` activity feed too (currently prints full UUIDs — a gap).
- **tokens / cost** — stat strip format is `<in> in · <out> out · <cost>`; unpriced →
  `—`, excluded from totals, never `$0.00` (web-ui-guide.md).
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
- **Reconnect** (both surfaces): a visible, non-alarming pending state (`connecting…`,
  spinner/pulse) using the §1.1 vocabulary — then silent catch-up via `Last-Event-ID`; never
  a full reset of the view (web-ui-guide.md, DH-0024).
- **Focus & selection** are always visible (TUI selection highlight; Web focus ring in
  `--accent`). Never rely on color alone for the selected row — also a marker/indent.
- **Motion is purposeful:** running-pulse and content fade-in only. No spinners that outlive
  their operation, no decorative animation.

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
