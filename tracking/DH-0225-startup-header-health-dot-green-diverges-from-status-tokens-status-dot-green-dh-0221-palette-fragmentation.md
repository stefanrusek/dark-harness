---
spile: ticket
id: DH-0225
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0221]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0225: Startup-header health dot green diverges from STATUS_TOKENS status-dot green (DH-0221 palette fragmentation)

## Summary

DH-0221 introduced the `BRAND` palette (Tokyo-Night-ish) alongside the pre-existing
`STATUS_TOKENS` semantic-status palette in `src/design-tokens.ts`. The new CLI startup
header (DH-0220) paints its health `●` dot with `BRAND.harnessGreen` (`#9ECE6A`) for "ok",
while the TUI/Web status dots use `STATUS_TOKENS`' greens for the same `●` glyph/semantic
meaning (`done` `#35c469`, `live` connection state sgr `32`). So "ok/live/green" currently
renders as up to three different greens depending which surface you're looking at.

`design-tokens.ts` deliberately documents `BRAND` and `STATUS_TOKENS` as coexisting, never
merged — different concerns (semantic status vocabulary vs. brand/role palette). **This
ticket does not reopen that decision.** It is a narrower UX-consistency call: which specific
green renders for the "ok/live" *status-dot* semantic wherever a `●` health/status dot
appears, so the same meaning doesn't paint three different colors across surfaces.

## Design decision (Muriel, design crew lead)

**Canonical ok/live green: `STATUS_TOKENS.done.webHex` = `#35c469`.**

Rationale:
- `STATUS_TOKENS`' green is the older, more established value — already load-bearing on the
  TUI agent tree (SGR `32`) and Web tree/sidebar (`--status-done: #35c469`), i.e. more
  existing surfaces than the four-day-old brand palette.
- Minimizing churn/blast-radius: this is a one-line change (the health-dot hex) versus
  changing `STATUS_TOKENS.done` (which would ripple into every existing done-agent dot on
  TUI and Web, the actually-widespread usage).
- No genuine visual-quality reason favors `#9ECE6A` over `#35c469` for this specific glyph —
  both are recognizably "green"; the ticket's whole premise is that inconsistency (not
  either color individually) is the defect.
- `BRAND.harnessGreen` is **not deprecated** and is **not changed**. It stays exactly as-is
  (`#9ECE6A`) for its other, non-status-dot uses in `src/cli/header.ts`: the wordmark
  gradient endpoints (`gradientWordmark`, header B glyph lerps), the `✓ ready — waiting for
  clients` checkmark, and the `dh:` log-prefix color. Those are decorative brand-identity
  accents (DH-0219/0220/0221's fresh visual language), not instances of the shared
  `●`-glyph status vocabulary this ticket governs — pulling them into `STATUS_TOKENS` green
  would flatten intentional brand distinctiveness for no consistency benefit (nothing else
  on any surface uses those roles). Scope is the health dot only.

### Exact change

`src/cli/header.ts`, function `healthDot` (currently ~line 61-64):

```ts
// Before
function healthDot(level: ColorLevel, healthy: boolean): string {
  const hex = healthy ? BRAND.harnessGreen : BRAND.leadOrange;
  return paint(hex, "●", level);
}

// After
function healthDot(level: ColorLevel, healthy: boolean): string {
  const hex = healthy ? STATUS_TOKENS.done.webHex : BRAND.leadOrange;
  return paint(hex, "●", level);
}
```

- Import `STATUS_TOKENS` alongside the existing `BRAND` import at the top of
  `src/cli/header.ts` (currently `import { BRAND, type ColorLevel, fgCode, lerpHex, paint,
  wrapSgr } from "../design-tokens.ts";`).
- The `healthy: false` branch is unaffected — it stays `BRAND.leadOrange` (`#E0AF68`); this
  ticket is scoped to the ok/live green only, not the unhealthy/warning color (which has no
  `STATUS_TOKENS` analog to reconcile against — `failed`/`stopped` reds/purples are a
  different semantic than a startup-probe warning).
- No other call site in `src/cli/header.ts` changes (see Rationale above — gradient,
  checkmark, and `dh:` prefix all keep `BRAND.harnessGreen`).
- No change to `src/design-tokens.ts` itself — `STATUS_TOKENS.done` already has the value we
  want; we're just pointing a new consumer at it. `BRAND.harnessGreen`'s value/comment is
  unchanged.

### ANSI-256 downsample impact: none

`nearestAnsi256` (`src/design-tokens.ts`) is a **pure function computed at call time** from
whatever hex it's given — there is no precomputed/cached index table keyed to
`BRAND.harnessGreen` or any other specific hex to invalidate. Swapping which hex
`healthDot()` passes into `paint()`/`fgCode()` just changes the runtime input to
`nearestAnsi256` on the `ansi256`-level code path; no cached index, no recalculation step,
no `BRAND` table value changes. (Confirmed by reading `nearestAnsi256`'s implementation:
it re-derives the nearest cube/grayscale index from the RGB channels every call, no memo.)
If any test asserts a specific ansi256 index for the *healthy* health dot (e.g. a golden
string containing `38;5;<N>` for `#9ECE6A`'s nearest index), that assertion must be updated
to `#35c469`'s nearest ansi256 index instead — see Functional Requirements below.

### `docs/design/style-guide.md` updated

Added to §3 (Glyph & iconography vocabulary), the `●` row: canonical ok/live green is
`STATUS_TOKENS.done.webHex` `#35c469` for every surface including the CLI startup header's
health dot, never `BRAND.harnessGreen` for this glyph; `BRAND.harnessGreen` remains in play
for the header's other non-status-dot brand flourishes.

## User Stories

- As an operator watching `dh --server` start up, when the health dot renders "ok" in the
  startup header, then it renders in the same green (`#35c469` truecolor / nearest-ansi256 /
  SGR `32` at lower color levels) as a `done` agent's status dot in the TUI tree and the Web
  sidebar, so "ok/live/green" means one visual color across every surface I look at.
- As an implementer reading `src/cli/header.ts`, when I look at `healthDot()`, then the
  healthy-branch hex is `STATUS_TOKENS.done.webHex` (imported from `../design-tokens.ts`),
  not `BRAND.harnessGreen`, so the source directly encodes which palette governs this glyph.
- As a maintainer reading `docs/design/style-guide.md` §3, when I look up the `●` glyph
  row, then it states the canonical ok/live green and which token/hex is authoritative, so
  future status-dot additions don't reintroduce fragmentation.

## Functional Requirements

- `src/cli/header.ts`'s `healthDot(level, healthy: true)` must paint `●` using
  `STATUS_TOKENS.done.webHex` (`#35c469`), not `BRAND.harnessGreen`.
- `healthDot(level, healthy: false)` is unchanged: `BRAND.leadOrange` (`#E0AF68`).
- All other `BRAND.harnessGreen` usages in `src/cli/header.ts` (gradient wordmark endpoints,
  `✓ ready` checkmark, `dh:` log prefix) are unchanged — do not touch them as part of this
  ticket.
- `src/design-tokens.ts` is unchanged — no edits to `BRAND` or `STATUS_TOKENS` values.
- Existing/new unit test coverage in `src/cli/header.test.ts` (or wherever `healthDot`/header
  rendering is currently tested) must assert the healthy dot's painted output uses
  `#35c469`'s truecolor SGR sequence (`38;2;53;196;105`) at `truecolor` level, and its
  correct nearest-ansi256 index (computed via `nearestAnsi256("#35c469")`, not hardcoded
  from the old `#9ECE6A` value) at `ansi256` level — update any existing golden-string
  assertion that still encodes `#9ECE6A`/its ansi256 index for the healthy branch.
- `docs/design/style-guide.md` §3's `●` glyph row documents `#35c469` as the canonical
  ok/live green across all surfaces, including the CLI startup header (done as part of this
  ticket, by Muriel — no further doc work needed by the implementer).

## Assumptions

- "Health dot" in this ticket refers specifically to `healthDot()` in `src/cli/header.ts` —
  the `●` glyph rendered next to `dh <version>` in the startup header per DH-0220. No other
  glyph in the startup header (checkmark, warning triangle) is in scope.
- `STATUS_TOKENS.done` is the correct semantic peer for "server ready" — both mean "the
  steady-state ok condition," distinct from `running`/`waiting` (in-progress) or
  `failed`/`stopped` (terminal-bad). `CONNECTION_TOKENS.live` was considered but rejected as
  the reference token because it has no `webHex`/truecolor value in its current shape (only
  an SGR code, which already happens to be the same `32` green as `STATUS_TOKENS.done` — no
  conflict either way), so `STATUS_TOKENS.done.webHex` is the more direct, already-truecolor
  source of truth to import.

## Risks

- Low risk, one-line functional change plus an import addition; no contracts, no schema, no
  cross-domain coordination beyond Grace (Core, owns `src/cli/`) implementing it.
- If a snapshot/golden test elsewhere in the repo pins the full startup-header output
  (including the healthy dot's raw escape sequence), that snapshot will need regenerating —
  called out explicitly in Functional Requirements so it isn't missed as a "why did this
  fail" surprise.

## Open Questions

None — decision is final per this ticket; no TODOs left for the implementer.

## Notes

- 2026-07-19 (Muriel): Ticket specced end-to-end — design decision, exact hex/token change,
  confirmed no ANSI-256 cache-invalidation concern, style-guide.md §3 updated in the same
  pass. Moving draft -> ready.
- 2026-07-19 (Grace, implementer): The exact `healthDot()` change (STATUS_TOKENS import +
  swapping the healthy branch to `STATUS_TOKENS.done.webHex`) had already landed at HEAD as
  part of a concurrent DH-0224 commit (`f6d23c3`) that touched the same lines while my staged
  hunk was in the shared working-tree index — confirmed the diff matches this ticket's spec
  exactly, no further source change needed. Added the test coverage the Functional
  Requirements call for: `src/cli/header.test.ts`'s new `describe("healthDot color
  (DH-0225)")` asserts the healthy dot's truecolor SGR sequence and ansi256 index resolve
  from `#35c469`, not `#9ECE6A`, isolated to the status-tree line (not the whole rendered
  header) so it doesn't false-positive against the wordmark gradient's legitimate
  harnessGreen->signalCyan span. `healthy: false` (`BRAND.leadOrange`) untouched, confirmed
  by reading the current source. Gates: typecheck has pre-existing unrelated failures from
  other agents' concurrent in-flight work (`src/agent/mcp/*`, `src/agent/tools/*`,
  `src/config/validate.ts`) — none touch `src/cli/header.ts`; `bun run lint` clean on
  `header.ts`/`header.test.ts`; `bun test src/cli/header.test.ts` 28/28 pass,
  `src/cli/header.ts` at 100% line/function coverage; full `bun test src --coverage` had one
  unrelated pre-existing failure (`src/agent/tools/mcp-auth.test.ts`, another agent's WIP);
  `bun run e2e` 41/41 pass. Commit `fdaa633`, pushed to
  `claude/coordinator-onboarding-kab9ls`. Closing directly — trivial, fully verified, no
  ambiguity left for a separate verifying pass.
