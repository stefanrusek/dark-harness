---
spile: ticket
id: DH-0101
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0098, DH-0099, DH-0067, DH-0035]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0101: Give CLI command output a real visual system (glyphs, hierarchy, color, liveness) beyond dh doctor

## Summary

Every CLI surface except dh doctor is undifferentiated plaintext 'dh: <sentence>' lines with no color, glyph, hierarchy, or liveness: dh init, --version, --dry-run, the --server startup block, and the activity feed. Correct but lifeless. Apply the design-guide CLI conventions (§5): verdict glyphs, result-headline+detail+next-step shape, TTY-gated color/liveness, short agent ids in the feed.

`dh doctor` got a live, colorized, in-place experience in DH-0099 and the operator's reaction
was "this is the kind of thing I keep asking for." Every *other* CLI surface is still flat
`dh: <sentence>` plaintext with no color, glyph, hierarchy, or liveness. This ticket brings
the rest of the CLI up to the doctor bar, following `docs/design/style-guide.md` §5 (CLI
conventions), §1.1 (liveness), §3 (glyphs). Owners: Grace (Core/CLI — `src/cli.ts`) with
Radia consulted for the `--server` runtime lines that originate server-side.

In-scope surfaces (all in `src/cli.ts` unless noted):

1. **`dh init`** (`runInit`, ~L1038) — five equal `dh:` lines today. Target: a success
   headline with a `✓` glyph (`dh: ✓ wrote dh.json`), the model-menu/region caveats as
   indented dim supporting detail, and a visually set-off **next-step** callout (`Next: run
   dh doctor to probe credentials, then dh to start`).
2. **`--server` startup block** (`runInteractiveMode`, ~L950–958) — "listening on port…",
   version/bind/logs line, connect hint, and the security-posture note. Target: reads as a
   startup *panel* — a headline (what's running + where), the connect hint, and the posture
   note visually marked as a caution (dim/yellow, `⚠`), not just another sentence in the
   stack. Keep the two byte-stable lines e2e greps (`headless server listening on port …`,
   `web UI ready at …`) parseable — add styling around them without breaking the substring.
3. **`ActivityFeed`** (L231–265) — lifecycle lines use full 36-char agent UUIDs, no color,
   no glyph. Target: short agent ids (`shortAgentId`, design guide §4), a status-colored `●`
   per transition matching the §1 status colors, dim wall-clock timestamp; keep it one
   concise line per transition (the DH-0067 "cheap and glanceable" contract).
4. **`--dry-run`** (~L1216) and **`--version`** (`formatVersionString`, L200) — single lines;
   at minimum a `✓` glyph on the dry-run success and light emphasis (bold app name) on
   version. Small, but they're part of the felt whole.

## User Stories

### As an operator running `dh init`, I want the output to guide me, not just report

- Given `dh init` succeeds on a TTY, when it prints, then the first line is a success
  headline with a green `✓` glyph naming what was written, followed by indented dim caveats
  (model menu, region), followed by a clearly-set-off next-step line.
- Given `dh init` runs off a TTY (piped/CI), when it prints, then color and glyphs are
  dropped but the same information and line structure remain (design guide §1.1 / §5 non-TTY
  degrade), and no stray ANSI leaks into the pipe.

### As an operator starting `dh --server`, I want startup to read as a status panel

- Given the server starts, when the startup block prints on a TTY, then it reads as a small
  panel: a headline (server + port + session), the connect hint, and the log path — with the
  plaintext-no-auth posture note visually marked as a caution (`⚠`, yellow/dim), not
  indistinguishable from the other lines.
- Given the two e2e-grepped lines (`headless server listening on port <n>`, `web UI ready at
  <url>`), when styled, then their existing substrings remain intact and greppable (styling
  wraps, never rewrites, them).

### As an operator watching `--server` activity, I want glanceable, identifiable events

- Given an agent lifecycle transition, when the activity feed prints it, then it shows a
  short agent id (not a 36-char UUID) and a status-colored `●` matching the canonical status
  colors, with a dim timestamp — one line per transition.
- Given `--quiet`, when set, then the feed stays fully silent exactly as today (only the
  one-time startup block prints).

### As an operator, I want the small commands to feel finished too

- Given `--dry-run` succeeds, when it prints, then the line leads with a green `✓` on a TTY.
- Given `--version`, when it prints, then the app name/version is lightly emphasized (bold on
  a TTY) rather than flat.

## Functional Requirements

- All color/glyph output is TTY-gated on `process.stdout.isTTY === true`, reusing the exact
  gate and color-constant style DH-0099 established for doctor (`DOCTOR_PASS_COLOR` etc.) —
  ideally factor a tiny shared CLI-styling helper so init/doctor/server don't each re-invent
  green/red/dim/`✓`/`✗`. Off-TTY output is plain text, same information, no stray ANSI.
- Verdict/status glyphs: `✓` (green) success, `✗` (red) failure, `●` (status-colored per
  design guide §1) for lifecycle status, `⚠` (yellow/dim) for cautions. No new SGR beyond
  the terminal palette already in use.
- The `dh: ` prefix is retained on every line for grep/log identity; a headline may lead with
  a glyph *after* the prefix (`dh: ✓ …`).
- Short agent ids in the activity feed via the existing `shortAgentId` convention (mirror
  `src/web/client/format.ts`; if that helper isn't reachable from `src/cli.ts`'s domain,
  request/relocate a shared formatter rather than forking the logic).
- 100% coverage on changed code (CLAUDE.md §5). Because ANSI-in-a-terminal is exactly the
  class of thing that passes a mocked-stdout test while looking wrong live, verify each
  changed surface in a real terminal and describe the result in the closing report (the
  DH-0099 verification discipline).

## Assumptions

- This is *presentation only* — no change to what information each command reports, only how
  it's shaped. Wording may be tightened but the facts stay.
- The activity feed's per-transition-line contract (DH-0067) stays; this adds identity/color,
  it does not change the event→line mapping or add per-turn spam.

## Risks

- Byte-stable startup lines are asserted by e2e (`headless server listening on port`, `web UI
  ready at`). Styling that rewrites rather than wraps them breaks those tests — wrap only,
  and run the e2e suite.
- Over-decorating server logs hurts operators who pipe `--server` into a log aggregator —
  hence the strict non-TTY plaintext degrade. Verify piped output is clean.
- Short-id-only in the feed could hide *which* full agent when debugging; keep the full id in
  the JSONL logs (it already is) so the feed can stay short without losing traceability.

## Open Questions

- Should the `--server` startup "panel" use any box-drawing framing (a top rule, indented
  body) or stay as prefixed lines with just glyph/color? Recommend lines + glyph/color (no
  box) to keep it copy-pasteable and log-friendly — but Grace/Radia's call at implementation.
- `dh init`'s next-step callout wording — keep terse; the design crew can review the exact
  copy in refining.

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew). This is the largest "bring delight" surface: the
> CLI is what an operator meets first (`init`/`doctor`) and lives in when running headless
> (`--server`). DH-0099 proved the appetite; this generalizes its treatment. Deliberately
> scoped to presentation — `--help` is its own ticket (DH-0103) because it needs width-aware
> layout work, and `dh doctor`'s glyph migration is DH-0102.
