---
spile: ticket
id: DH-0102
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0099]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0102: dh doctor: migrate to the canonical pending spinner and check/cross verdict glyphs

## Summary

DH-0099 gave dh doctor live per-model progress, but its vocabulary is bespoke: a '....' four-dot pending marker and word verdicts PASS/FAIL. Align it to the design-guide pending/verdict vocabulary (§1.1/§5): the canonical braille spinner + 'checking…' wording while in flight, and a green ✓ / red ✗ glyph beside the verdict word on resolution.

DH-0099 made `dh doctor` live and in-place — a real win. But its vocabulary predates the
design system and is bespoke: the in-flight marker is a literal `....` (four dots) and the
verdicts are the bare words `PASS`/`FAIL`. The design guide (§1.1 pending state, §3 glyphs,
§5 verdict glyphs) defines a *shared* liveness/verdict vocabulary — an animated braille
spinner + present-progressive wording for pending, and `✓`/`✗` glyphs beside verdicts. This
ticket aligns doctor to it so the harness's flagship "flashy pop" is also the canonical one
that init/server (DH-0101) copy, rather than a one-off. Owner: Grace (`src/cli.ts`).

Current (from `runDoctor`/`formatDoctorPendingRow`/`formatDoctorRow`, `src/cli.ts` L1063–
1177): pending row = `.... <name> checking... (query sent)` in dim; resolved row = colored
word `PASS`/`FAIL` + padded name + detail; rewritten in place via `\r\x1b[K`; summary line
`N models: X pass, Y fail` (never colored). All correct mechanically — this is a vocabulary/
glyph refinement, not a rework of the live-update machinery.

## User Stories

### As an operator, I want the doctor's in-flight state to use the same live spinner as the rest of the tool

- Given a model check is in flight on a TTY, when its pending row shows, then the marker is
  the canonical braille spinner frame (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, the same frames the TUI header uses),
  animating while the check is outstanding, with present-progressive wording (`checking…`) —
  not a static `....`.
- Given the spinner animates, when a check takes more than one frame interval, then the frame
  advances in place (same `\r\x1b[K` rewrite already used), so the row visibly "spins" rather
  than sitting frozen.

### As an operator, I want a verdict I can read at a glance by shape, not only by word

- Given a model check resolves to pass on a TTY, when its row is rewritten, then it leads
  with a green `✓` glyph beside the `PASS` word (design guide §5).
- Given it resolves to fail, when rewritten, then it leads with a red `✗` glyph beside
  `FAIL`.
- Given the trailing summary line, when printed, then it may carry the same `✓`/`✗` framing
  and/or color (e.g. green when all pass, red when any fail) so the overall result reads
  instantly — today the summary is always uncolored.

### As an operator piping doctor into CI/logs, I want the output to stay clean plain text

- Given stdout is not a TTY, when doctor runs, then no spinner, no in-place rewrite, no glyph
  animation — the once-at-the-end plain report exactly as today (design guide §1.1 non-TTY
  degrade; DH-0099's contract). `✓`/`✗` glyphs are TTY-only decorations; the plain report
  keeps the `PASS`/`FAIL` words.

## Functional Requirements

- Replace `formatDoctorPendingRow`'s `....` with a spinner frame sourced from the same frame
  set the TUI uses (`SPINNER_FRAMES` in `src/tui/render.ts`) — factor the frame array into a
  shared location both can import rather than duplicating it, so the design guide's "one
  spinner everywhere" (§1.1/§3) is true in code, not just prose. If crossing the
  `src/tui/`↔`src/cli.ts` boundary is awkward, request a small shared util module (Core owns
  it) rather than copy-pasting frames.
- Animate the pending frame: the `runDoctor` loop must advance the frame while a single
  `provider.complete()` is outstanding (e.g. a timer that rewrites the pending row every
  `SPINNER_FRAME_MS` = 120ms until the promise settles). Keep it strictly TTY-gated and make
  sure the timer is always cleared on resolve/throw so it can't leak past the check.
- `formatDoctorRow`: prepend `✓ ` (green) / `✗ ` (red) before the `PASS`/`FAIL` word on the
  colorized (TTY) path; the plain path keeps just the words.
- Summary line: colorize/glyph it on the TTY path (green all-pass / red any-fail); unchanged
  plain text off-TTY.
- Preserve exact column alignment across pending→resolved rewrite (the whole point of the
  shared `nameWidth` padding) now that a leading glyph is added — the pending and resolved
  rows must still occupy the same columns so the `\r\x1b[K` rewrite lands cleanly.
- 100% coverage on changed code; add assertions for the glyph presence on the colorized path
  and its *absence* on the plain path. Verify live in a real terminal (the DH-0099 lesson:
  animated cursor/line rewrite can pass a mocked-stdout test while looking broken) and
  describe the observed spin/rewrite in the closing report.

## Assumptions

- Scoped to `dh doctor`/`--check` only; `--dry-run` has no per-model network wait to animate.
- The animated-spinner-during-a-single-await is worth the small added complexity because
  individual model probes can take seconds (a real Bedrock cold call), during which a static
  `....` still looks frozen — the DH-0099 report itself noted a single slow check is where the
  blank-wait pain lives.

## Risks

- A per-check animation timer is fiddly: it must not double-write, must always be cleared on
  both resolve and throw, and must not corrupt the line the moment the resolved row is
  written (race between the last timer tick and the final rewrite). Real-terminal
  verification is mandatory, not optional.
- Sharing `SPINNER_FRAMES`/`SPINNER_FRAME_MS` across `src/tui/` and `src/cli.ts` touches a
  domain boundary (Mary owns TUI). Coordinate the extraction; don't fork the constants (the
  design guide explicitly wants one spinner) and don't reach across the boundary unilaterally.

## Open Questions

- Should the spinner also appear on the *non-animated* single-check case (a config with one
  model that resolves fast)? Fine either way — the frame just won't advance; keep the code
  path uniform rather than special-casing single-model configs.

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew) as the natural follow-on to DH-0099. Small, high-
> delight, and it's the piece that makes the doctor's liveness *the canonical* liveness the
> rest of the CLI (DH-0101) mirrors, rather than a bespoke one-off. Depends conceptually on
> the design guide's spinner/glyph vocabulary being settled (it is, §1.1/§3).
