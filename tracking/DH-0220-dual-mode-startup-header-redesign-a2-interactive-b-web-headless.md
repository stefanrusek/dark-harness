---
spile: ticket
id: DH-0220
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0219]
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

## Functional Requirements

- Mode detection: explicit `--headless`/web-serve config wins; otherwise TTY detection via
  `process.stdout.isTTY`. Non-TTY always gets the plain fallback regardless of mode.
- Implement both headers with the exact layouts/palette above. Reuse DH-0219's shared palette
  source of truth if one exists.
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
