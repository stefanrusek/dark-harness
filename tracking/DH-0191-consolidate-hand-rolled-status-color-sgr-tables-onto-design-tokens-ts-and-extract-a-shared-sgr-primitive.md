---
spile: ticket
id: DH-0191
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0174, DH-0137]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0191: Consolidate hand-rolled status-color/SGR tables onto design-tokens.ts and extract a shared SGR primitive

## Summary

cli.ts and src/server/log-analysis.ts still hand-roll their own copies of the five-status SGR color map that src/design-tokens.ts (DH-0137) already owns as the single source of truth, and generic SGR helpers (colorize/dim/bold/reset, verdict glyphs) are independently redefined in cli.ts and src/tui/ink/tokens.ts. This is the cross-domain (Core + Server + TUI) ANSI sub-item split out of DH-0174, reframed around design-tokens.ts, which post-dates DH-0174's filing and changes the shape of the fix from 'create a shared primitive' to 'migrate the remaining stragglers onto the shared table that now exists + extract the still-duplicated generic SGR helpers'.

## Domain / owner

Cross-domain — flag for coordinator triage. Touches Core (`src/cli.ts`), Server
(`src/server/log-analysis.ts`), and TUI (`src/tui/ink/tokens.ts`). The canonical source of
truth (`src/design-tokens.ts`) is a root-level shared module (DH-0137). No `src/contracts/`
change and no wire-truth change — SGR codes are presentation, not protocol — so this is a
routine coordinator slice, not a §6 escalation, but it cannot be handed to a single domain
owner as-is.

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0190)._

## Current-state findings (refactoring round DH-0190, 2026-07-19)

`src/design-tokens.ts` (DH-0137) exists and exports `STATUS_TOKENS: Record<AgentStatus,
StatusToken>`, where each `StatusToken` already carries a `.sgr` field (the TUI/CLI SGR
foreground code) — it is explicitly the "extracted so both surfaces can't independently
re-derive these tables and silently drift" module. Despite that, two copies of the same
five-entry status→SGR map still exist independently:

1. `src/cli.ts` `CLI_STATUS_COLOR` (`{ running: "\x1b[34m", waiting: "\x1b[33m", done:
   "\x1b[32m", failed: "\x1b[31m", stopped: "\x1b[35m" }`) — used by `cliStatusDot` for the
   `--server` activity feed. Its own comment even acknowledges the duplication ("Kept as its
   own literal rather than imported, matching the existing DH-0100 pattern where ...
   log-analysis.ts and render.ts each already keep an independent copy") — but design-tokens
   .ts now supersedes that rationale.
2. `src/server/log-analysis.ts` `STATUS_COLOR` (lines ~201-208) — byte-identical map, plus its
   own `RESET` constant and `colorizeStatusLabel` helper, used by `dh logs` status
   colorization.

Separately, generic (non-status) SGR helpers are redefined too:

3. `src/cli.ts` defines `CLI_GREEN/CLI_RED/CLI_YELLOW/CLI_DIM/CLI_BOLD/CLI_RESET` plus
   `cliColorize/cliDim/cliBold/cliSuccessGlyph/cliCautionGlyph`.
4. `src/tui/ink/tokens.ts` defines its own `RESET`, `colorizeStatus`, `dim`, `bold`.
5. `src/tui/markdown-ansi.ts` and `src/markdown/rendering-fixtures.ts` each define `RESET`
   again (lower-priority — markdown rendering, a distinct concern; call out but don't
   necessarily fold in).

So the fix shape has changed since DH-0174 framed this as "a shared ANSI/color primitive
would serve all three": the shared *status-table* already exists (design-tokens.ts) and just
needs the two stragglers (items 1, 2) migrated onto it; what's genuinely still missing is a
shared *generic-SGR* helper (colorize/dim/bold/reset + TTY gating) that items 3-4 could share.

## Functional Requirements

- Migrate `cli.ts` `CLI_STATUS_COLOR` and `log-analysis.ts` `STATUS_COLOR` to read
  `STATUS_TOKENS[status].sgr` from `src/design-tokens.ts` — one source of truth for the
  five-status palette across CLI/Server/TUI. Behavior (the actual bytes emitted) must be
  unchanged; this is a de-duplication, verified by the existing snapshot/format tests staying
  green.
- Decide the home for the generic SGR helpers (colorize/dim/bold/reset + TTY gate). Candidate:
  extend `src/design-tokens.ts` (already the dependency-free root-level shared module) or a
  sibling `src/sgr.ts`. Then migrate `cli.ts`'s `cliColorize`/`cliDim`/`cliBold` and
  `src/tui/ink/tokens.ts`'s `dim`/`bold` onto it. Verdict glyphs (`✓`/`✗`/`⚠`/`●`) and their
  TTY gating are shared vocabulary too — style-guide §3/§5 — and are a reasonable second
  export from the same module.
- Note the coupling with DH-0174: DH-0174's plan extracts a `src/cli/styling.ts` module as a
  cli-local landing spot for these helpers. Whichever ticket lands second should point the
  cli-local module's *internals* at this shared primitive rather than re-duplicating. Order is
  not strictly constrained (either can land first) but the second must not reintroduce the
  copy.

## Risks

- Low behavioral risk (pure de-duplication of constants that must stay byte-identical), but
  the change spans three domains' files at once, so it needs coordinator sequencing against
  any in-flight TUI/Server/CLI work to avoid merge conflicts — the same churn concern that
  motivates DH-0174.
- The 100%-coverage gate applies: design-tokens.ts's `.sgr` field may not currently be
  exercised by a test that asserts the exact byte; migrating consumers onto it must keep
  coverage complete.

## Open Questions

- Home for the generic SGR helpers: fold into `design-tokens.ts`, or a new dependency-free
  `src/sgr.ts` sibling? (design-tokens.ts is currently about *tables*, not *helpers* — a
  taste call for the implementer/coordinator.)
- Whether the two markdown-rendering `RESET` constants (item 5) are in scope or deliberately
  left alone as an unrelated concern.

## Notes

Filed by Fable during refactoring round DH-0190 (2026-07-19). This ticket carries forward — and
reframes — the "cross-domain ANSI sub-item" that DH-0174 originally embedded in its Notes.
DH-0174 has been updated to hand that sub-item off to this ticket and scope itself purely to the
single-domain (Core) cli.ts split. Not a §6 escalation: presentation-layer SGR bytes are not
wire truth (`src/contracts/`), so no architect sign-off is required — but it is genuinely
cross-domain and must be sliced by the coordinator, not dropped on one domain owner.
