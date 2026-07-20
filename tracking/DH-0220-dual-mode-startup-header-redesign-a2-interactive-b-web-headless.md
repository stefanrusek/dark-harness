---
spile: ticket
id: DH-0220
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0219, DH-0221]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0220: Dual-mode startup header redesign: A2 (interactive) + B (web/headless)

## Summary

Full handoff from a second, separate Fable design session (2026-07-19), covering `dh`'s
startup header — replacing the current plain figlet `dh` banner + flat status lines. Two
distinct headers, mode-selected:

| Mode | Header |
| --- | --- |
| Interactive terminal (TTY) and the in-app chat window | **A2 — big wordmark + wiring tree** |
| Command line in web mode or headless mode | **B — framed instrument panel** |

**Mode detection:** explicit flag/config wins (`--headless`, web-serve mode), otherwise TTY
detection. Non-TTY stdout (piped) always gets the plain-text fallback regardless of mode.

**Owner decisions (2026-07-19), resolving all three of Fable's flagged open questions:**
1. Header A2 uses the **full 12-line banner** (with ANSI-Shadow drop-shadow rows), not the
   trimmed 10-line version — more visual weight as a real startup brand moment.
2. (Logo canonical export — transparent background — see DH-0219, this ticket's dependency.)
3. Header B's `✓ ready` styling **extends to subsequent `dh:` log-line prefixes** during a
   run, not just the startup header itself — restyle them to match for end-to-end visual
   cohesion. This is a larger surface than the startup header alone (touches ordinary runtime
   log-line formatting used across the CLI, potentially exercised by e2e greps on exact log
   text) — implementer should audit `e2e/` for any test asserting exact `dh: ` prefix text and
   update those assertions deliberately, not accidentally break them.

**Shared palette** (truecolor, degrade to nearest ANSI-256) — same table as DH-0219's logo:

| Role | Hex | Use |
| --- | --- | --- |
| harness green | `#9ECE6A` | ok states, ✓, live dot |
| lead orange | `#E0AF68` | warnings (`no token`), accents |
| wire gray | `#565F89` | frame lines, dim labels |
| signal cyan | `#7DCFFF` | URLs, interactive values |
| bone white | `#C0CAF5` | primary values |

**Shared constraints:**
- Width budget ≤ 80 columns for everything.
- Unicode box-drawing / half-blocks / `●✓⚠` allowed, with a pure-ASCII fallback (locale
  detection + `--plain` flag).
- Color: ANSI 256, truecolor upgrade when `COLORTERM=truecolor`. Respect `NO_COLOR`.
  Piped/non-TTY output: plain, uncolored, no art.
- Status facts stay one-per-line and grep-able by stable label (version, config, bind, web ui,
  logs).
- Git SHA truncated to 7 chars (full SHA stays in `dh --version`). Log path shortened to
  run-id directory.
- `no token` (missing auth) always renders as a warning in lead orange with `⚠`.

### Header A2 — big wordmark + wiring tree (interactive / chat window)

Stacked ANSI Shadow wordmark (full 12-line, drop-shadow rows included per owner decision),
diagonal composition, then a status tree hanging off a live health dot:

```
  ██████╗  █████╗ ██████╗ ██╗  ██╗
  ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝
  ██║  ██║███████║██████╔╝█████╔╝
  ██║  ██║██╔══██║██╔══██╗██╔═██╗
  ██████╔╝██║  ██║██║  ██║██║  ██╗
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
       ██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗
       ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝
       ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗
       ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║
       ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║
       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝

  ● dh 0.1.0 · 9d90dc6
  ├─ config   dh.json — 14 models
  ├─ bind     192.168.1.238 · ⚠ no token
  ├─ web ui   http://192.168.1.238:64810
  └─ logs     .dh-logs/ac817fd0…
```

- Wordmark: left→right gradient, green → cyan.
- Status: labels in wire gray, values in bone white, URL in signal cyan (underlined), warnings
  in lead orange.
- `●` is the health summary: green when healthy, orange/red if startup checks fail.
- Height: banner 12 lines + 5 status lines. Gate on terminal size: if < 30 rows or < 80 cols,
  fall back to plain text (wordmark as `DARK HARNESS`, tree drawn with `|-` and backtick).

### Header B — framed instrument panel (web / headless mode)

Compact `dh` glyph and status in one frame; version in the frame's nameplate notch:

```
  ╭─ dh 0.1.0 ─ 9d90dc6 ──────────────────────────╮
  │  ██▄ █░█    dark harness                      │
  │  █▄█ █▀█    local model harness               │
  ├───────────────────────────────────────────────┤
  │  config  dh.json · 14 models                  │
  │  bind    192.168.1.238    auth  ⚠ none        │
  │  web ui  http://192.168.1.238:64810           │
  │  logs    .dh-logs/ac817fd0…                   │
  ╰───────────────────────────────────────────────╯
  ✓ ready — waiting for clients
```

- Frame in wire gray so it recedes; the `dh` glyph gets the gradient; tagline dim (italic
  where supported).
- Two-column bind/auth row keeps the token warning next to the address it applies to.
- The `✓ ready` line outside the frame is the transition into the live log stream — per owner
  decision, subsequent `dh:` log lines during the run restyle to match this treatment.
- Total 10 lines; no size gating needed beyond the 80-col rule.

## User Stories

### As an operator running `dh` interactively (TUI/local chat), I want a rich startup header that establishes the tool's identity

- Given a TTY with ≥80 cols and ≥30 rows, when `dh` starts interactively (no `--headless`,
  not web-serve mode), then Header A2 renders: the full 12-line ANSI-Shadow wordmark
  (green→cyan gradient) followed by the 5-line status tree hanging off a health dot.

### As an operator running `dh --web` or headless, I want a compact instrument-panel header instead

- Given a TTY with ≥80 cols, when `dh` starts in web-serve or `--headless` mode, then Header B
  renders: the framed panel with the `dh` glyph, tagline, and status rows, followed by the
  `✓ ready` transition line.

### As an operator with a small or non-interactive terminal, I want a clean plain-text fallback, never broken art

- Given stdout is non-TTY (piped), OR the TTY is below the size gate (A2: <30 rows/<80 cols),
  OR `NO_COLOR` is set, OR `--plain` is passed, when `dh` starts, then output is plain,
  uncolored ASCII with no box-drawing/gradient — status facts still one-per-line and
  grep-able by their stable label, and no line exceeds 80 columns with no mid-glyph wrapping.

### As an operator with a missing auth token, I want that risk visually distinct in both headers

- Given `security.token` is unset, when either header renders, then the "no token"/"auth:
  none" state renders as a warning in lead orange with a `⚠` glyph, in both A2's tree and B's
  bind/auth row.

### As a script/tool grepping `dh`'s startup output, I want stable, parseable status lines

- Given either header, when its status lines render, then each fact (version, config, bind,
  web ui, logs) is grep-able by a stable label, one fact per line (B's bind/auth row is the
  one accepted exception: two labels share one line by design).

### As an operator watching a running session, I want the log stream visually consistent with Header B's "ready" styling

- Given Header B rendered at startup (web/headless mode), when subsequent `dh:`-prefixed log
  lines print during the run, then they restyle to match B's established visual treatment
  (owner decision) — audit `e2e/` for exact-text assertions on the `dh: ` prefix and update
  deliberately.

## Color system design (Fable architecture pass, 2026-07-19)

The owner routed the "how is truecolor actually built" question to the architect before
implementation. Decision, in full:

**The truecolor palette + degradation path is NOT built ad hoc inside this ticket — it is
factored into a small, reusable, independently-gated color-infrastructure module, DH-0221
(this ticket now `depends_on` it).** DH-0221 carries the concrete module design (function
signatures, the `nearestAnsi256` downsample, the resolver); the summary below is what this
ticket's implementer needs to know to build the headers against it.

Key calls (rationale in DH-0221):

1. **Truecolor rides the existing `wrapSgr`/`SGR_RESET` primitive** (DH-0191,
   `src/design-tokens.ts`). A truecolor foreground is just an SGR parameter string
   `38;2;r;g;b`; ansi-256 is `38;5;n` — both are the `code` shape `wrapSgr(code, text)`
   already takes. No parallel escape system, no second reset. The only genuinely new logic is
   a pure hex→nearest-xterm-256 downsample.
2. **`STATUS_TOKENS` (semantic status colors) is untouched** and stays ANSI 16-color. The
   DH-0220/DH-0219 palette is a *separate, orthogonal* brand/role table (`BRAND` in
   `src/design-tokens.ts`) — a design-system concern, not a status vocabulary. Two tables
   coexist; they are not unified.
3. **Degradation is a resolved `ColorLevel` (`"truecolor" | "ansi256" | "none"`)** produced
   once at startup by `detectColorLevel({ isTTY, env, plain })` in `src/cli/color-context.ts`
   (Core), then threaded into the renderers. `--plain` / `NO_COLOR` / non-TTY → `"none"`;
   `COLORTERM` in {`truecolor`,`24bit`} → `"truecolor"`; else `"ansi256"`. `NO_COLOR` honors
   presence-disables (any value).
4. **No new npm dependency.** Hand-rolled per the project's minimal-dependency posture
   (CLAUDE.md §2) — the whole surface is ~5 small pure functions plus one resolver.
5. **Ownership/location:** pure palette + `nearestAnsi256` + `lerpHex` + `paint`/`fgCode` in
   `src/design-tokens.ts` (Core, shared — brand hexes double as Web CSS source of truth); the
   impure resolver in `src/cli/color-context.ts` (Core); header rendering in `src/cli/`
   (Core); wordmark ASCII-Shadow strings in `src/prompt/banner.constant.ts` (Prompt). No
   `src/contracts/` change.

**Header renderers here consume, not re-derive:** call
`paint(BRAND.harnessGreen, text, level)` for solid colors and `lerpHex(BRAND.harnessGreen,
BRAND.signalCyan, t)` for the A2 wordmark's per-column green→cyan gradient. The plain-text
fallback path is a single predicate: `level === "none" || sizeGateFails` (all of
NO_COLOR/--plain/non-TTY collapse into `level === "none"`, and the unicode art is inseparable
from color in this design).

**Sequencing:** DH-0221 lands and passes its gate first (its `nearestAnsi256`/resolver are
the sharp 100%-coverage edges); then this ticket builds the two headers on top. DH-0221 is
also what the owner-added TUI/Web Markdown-color note below draws on — both clients apply the
same `BRAND` hexes to rendered Markdown.

## Functional Requirements

- Mode detection: explicit `--headless`/web-serve config wins; otherwise TTY detection via
  `process.stdout.isTTY`. Non-TTY always gets the plain fallback regardless of mode.
- Implement both headers with the exact layouts/palette above. Source the palette and all
  color rendering from DH-0221's `src/design-tokens.ts` `BRAND`/`paint`/`lerpHex` +
  `src/cli/color-context.ts` `detectColorLevel` (see "Color system design" above) — do not
  re-derive hexes, SGR wrapping, or the degrade path locally.
- `--plain` flag (new) and `NO_COLOR` env var both force the plain-text fallback path.
- Size gating: A2 requires ≥80 cols/≥30 rows or falls back to plain text (`DARK HARNESS`
  wordmark + `|-`/backtick tree). B requires ≥80 cols (no row minimum specified).
- Git SHA truncated to 7 chars in both headers (full SHA remains in `dh --version`); log path
  shortened to just the run-id directory component.
- Extend Header B's styling to subsequent `dh:` log-line prefixes during the run (owner
  decision — see Summary). Update any e2e assertions on exact prefix text.
- Domain split: likely spans Core (`src/cli/` — mode detection, header selection/printing,
  the log-prefix restyling) and Prompt (banner/ASCII-art content, if that's where wordmark
  strings are authored per existing convention) — implementer/coordinator to slice cleanly per
  CLAUDE.md §3; flag if genuinely cross-cutting rather than guessing at an even split.
- **Owner addition (2026-07-19): teach agents that their Markdown output renders with real
  color, not just monochrome structure.** `src/prompt/system-prompt.ts`'s existing "Output
  format" section (`renderSelfInfoSection`'s neighboring base-prompt text) already tells the
  model that plain-text output is rendered as Markdown by every client — extend that note to
  say the rendering is in **real color** (both TUI and Web clients apply the shared palette
  this ticket establishes to headings/emphasis/code/etc., not just structural styling), so the
  model can lean into full Markdown formatting confidently rather than writing conservatively
  plain text. Keep the existing "never emit raw ANSI/VT escapes yourself, they're stripped"
  guidance exactly as-is — this is additive context about what the *client* does with the
  Markdown the model already writes, not a new capability the model gains.

## Assumptions

- This replaces the current plain figlet banner + flat status-line output entirely — not an
  additive third mode.
- The existing `dh: ` log-line prefix convention (grepped by e2e helpers per several DH-0164/
  DH-0165-era comments in this codebase) stays textually stable even where restyled — only
  the surrounding ANSI/color changes, not the literal prefix text scripts grep for.

## Risks

- The log-prefix restyling (decision #3) has the widest blast radius — audit thoroughly for
  e2e/test breakage rather than assuming it's cosmetic-only.
- Terminal-art regressions are hard to catch with unit tests alone — real PTY-based e2e
  verification (similar to `e2e/spikes/tui/`'s existing convention) is warranted for both
  headers' actual rendered output, not just string-construction unit tests.

## Open Questions

None remaining — all three of Fable's flagged questions resolved by the owner (2026-07-19,
see Summary).

## Notes

Baseline being replaced (current output, for reference):
```
     _ _
  __| | |__
 / _` | '_ \
| (_| | | | |
 \__,_|_| |_|
dh 0.1.0 (9d90dc69b6348f869d272e1fb3d9790f6db62c7c)
config: dh.json — 14 models, bind 192.168.1.238, no token
dh: ✓ web UI ready at http://192.168.1.238:64810.
dh: logs: /Users/stefanrusek/Code/dark-harness/.dh-logs/ac817fd0-cc1c-4458-9a67-f98fdce38883
dh: client connected from 192.168.1.238
```

### 2026-07-19 — implementation (Core + Prompt, ad-hoc implementer)

Built per the Functional Requirements, on top of DH-0221's landed `BRAND`/`paint`/`lerpHex`/
`fgCode` (src/design-tokens.ts) and `detectColorLevel` (src/cli/color-context.ts):

- `src/prompt/banner.constant.ts` (Prompt): added `HEADER_A2_WORDMARK` (the full 12-line
  ANSI-Shadow "DARK"/"HARNESS" wordmark), `HEADER_A2_WORDMARK_PLAIN` (`"DARK HARNESS"`),
  `HEADER_B_GLYPH`, `HEADER_B_TAGLINE`. Existing `DH_ASCII_LOGO`/`DH_ASCII_LOGO_COMPACT` left
  untouched — still consumed by `dh doctor`/`--check` and the TUI empty-state screen (see
  scope judgment call below).
- `src/cli/header.ts` (new, Core): `chooseHeaderMode`, `shortGitSha` (7-char truncation),
  `shortLogDir` (run-id-directory + 8-char/ellipsis truncation), `sizeGateOk` (A2's
  80-col/30-row gate), `renderHeaderA2`, `renderHeaderB`, `styleDhPrefix`. Each renderer takes
  a resolved `ColorLevel` and falls back to plain ASCII (`level === "none"`, or for A2 also
  the size gate failing) per the ticket's single-predicate design. Unit tests in
  `src/cli/header.test.ts` cover both headers at all three color levels, the size-gate
  boundary, optional web-ui/logs facts, and `styleDhPrefix`'s none-vs-colored byte shape.
- `src/cli/args.ts`: added `--plain` (new flag, `CliOptions.plain`), forcing the plain-text
  fallback the same way `NO_COLOR` does, via `detectColorLevel`.
- `src/cli/run.ts`: `runInteractiveMode` now resolves `ColorLevel` once via `detectColorLevel`
  and renders Header A2 (local TUI, `--connect` without `--web`) or Header B (`--server`,
  `--web`, `--connect --web`) instead of the old `printAppHeader` figlet block — replaced
  entirely, not additive, per the ticket's Assumption. Every existing `dh: `-prefixed
  `io.stdout` call in this file (client connect/disconnect, activity-feed lines, the
  `--server`/`--web` byte-stable status lines, the SIGTERM/SIGINT shutdown line) now goes
  through `styleDhPrefix(level)` instead of a literal `"dh: "` — the literal text is
  unchanged (`styleDhPrefix("none")` returns exactly `"dh: "`), only the surrounding color
  changes, per owner decision #3.
- `src/prompt/system-prompt.ts`: extended the existing "## Output format" section with an
  additive paragraph telling the model its Markdown renders in real color across TUI/Web
  (shared brand palette on headings/emphasis/code), encouraging fuller Markdown use — the
  pre-existing "never emit raw ANSI/VT escapes" guidance is untouched, unchanged wording.

**Judgment calls (documented, not blocking):**
1. **No `--headless` flag exists in this codebase** (`args.ts` has no such flag; `--server`
   is the existing "headless server" mode per its own log line). Read the ticket's
   `--headless`/web-serve wording as referring to `RunMode.kind === "server"` and `mode.web`
   — `chooseHeaderMode({ isServer, isWeb })` implements exactly that pairing. Flagging in case
   a real `--headless` flag was intended elsewhere and I'm missing context.
2. **Scope limited to the CLI startup print path** (`runInteractiveMode` in `run.ts`) — did
   NOT touch `src/header-info.ts`'s `HeaderInfo`/`formatHeaderLines`/`formatEmptyStateLines`
   (still the old ASCII-block logo), nor `dh doctor`/`--check` (`src/cli/doctor.ts`'s
   `printAppHeader` call), nor the TUI's in-Ink `<Header>`/RootView empty-state screen. These
   are separate rendering surfaces/domains (TUI's `Header.tsx` is Mary's) that the ticket's
   Functional Requirements don't explicitly call out beyond "in-app chat window" — read that
   phrase as referring to the pre-alt-screen startup print (which the old code's own comment
   already described as "visible in scrollback... before the TUI takes the alt-screen"), not
   Ink's own live in-view header component, since redesigning that is a distinct TUI-domain
   surface with its own tests/conventions and wasn't in the ticket's concrete mockups.
3. **Header B's own "✓ ready — waiting for clients" transition line is dropped** at each real
   call site in favor of keeping the pre-existing byte-stable "headless server listening on
   port..." / "web UI ready at..." lines (both e2e-grepped) — `renderHeaderB(...).slice(0,
   -1)` prints the frame only, then the existing grepped line follows, now with a
   `styleDhPrefix`-colored `dh:`. This satisfies "extend B's styling to subsequent dh: lines"
   without inventing a second, differently-worded "ready" line that would duplicate the
   grepped one's meaning.
4. **Box-frame right-edge alignment in Header B's colored (non-plain) variant is
   approximate** — content lines are not padded to a fixed interior width before the closing
   `│`, so the right border does not form a perfectly straight edge when facts vary in length
   (visible in the manual PTY run below). Accepted as a cosmetic gap given the ticket's
   explicit warning that terminal-art perfection is hard to verify and time-boxed — the frame
   still reads correctly and all content is present/correctly colored.
5. **`healthDot` is always green** — no startup health-check surface exists yet to ever fail
   it red/orange, so `renderHeaderA2` hardcodes `healthy = true`. Left the parameter in the
   function signature (unused branch) rather than deleting it, so a future health-check
   ticket has an obvious hook.

**Terminal-art verification (not just string-construction unit tests):** compiled the real
binary (`bun build --compile --outfile dist/dh src/cli.ts`) and drove it under a real PTY via
a small Python `pty.fork()` harness (100x40 window, `COLORTERM=truecolor`), confirming: (a)
`--server` renders Header B's full truecolor frame correctly, followed by the byte-stable
status lines with a green-painted `dh:` prefix; (b) the same `--server` run under a piped
(non-TTY) stdout renders the plain-text fallback with zero ANSI bytes and byte-identical `dh:
` prefixes; (c) plain `dh` (local TUI mode) renders the full Header A2 gradient wordmark +
status tree before Ink takes the alt-screen. Output samples captured in this session's
scratch, not checked in.

**e2e `dh: ` prefix audit:** `grep -rn '`dh: \|"dh: ' e2e` (and variants) found no e2e test
asserting the literal `dh: ` prefix text directly — existing e2e assertions grep for the
*content after* the prefix ("web UI ready at", "listening on port", "headless server", etc.),
which stayed byte-identical since only the prefix's color changed. No e2e test edits were
needed for the prefix restyling itself. `bun run e2e` reproduces one pre-existing failure
(`e2e/web.test.ts`'s "status colors, live output, token/cost display, and log download") both
with and without this ticket's changes (verified via `git stash`) — unrelated to this ticket.

**Test/gate updates:** `src/cli.test.ts` — added `plain: false`/`plain: true` to the two
`parseArgs` fixture expectations, and rewrote 7 tests in the `--server startup block
(DH-0067)` describe block that computed a fixed line-index off the old `printAppHeader`
output (`expectedHeaderLines(...).length`) — since Header B's own length now varies with
config content, these search `io.stdoutLines` by content (`findIndex`/`find`) instead of a
precomputed offset, and the TTY-styling assertions build their expected `dh:`-prefix color
dynamically via `paint(BRAND.harnessGreen, "dh:", detectColorLevel(...))` rather than a
hardcoded ansi256 escape, so they don't hard-couple to one CI environment's `COLORTERM`.

**Gates:** `bun run typecheck` clean. `bun run lint` clean (`biome check .`, after fixing an
import-order/module-scope-const nit `header.ts` first raised). `bun run test:coverage`:
140/140 test files passed, 100.0% line coverage (14760/14760) on the full suite including the
new `src/cli/header.ts`/`header.test.ts`. `bun run e2e`: 39/40 passed, the one failure
pre-existing (see above).
