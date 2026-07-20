---
spile: ticket
id: DH-0250
type: feature
status: refining
owner: Coordinator
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0249]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0250: Refactoring round 4: post-DH-0241 sweep (DH-0245/0246/0248/0129/0247 blast radius) — file DH-0249

## Summary

Fourth periodic refactoring round. Reviewed all commits since the DH-0241 sentinel; filed one finding (DH-0249, Header B top-border off-by-one).

Process ticket (DH-0141 mechanism), not an implementation ticket — output is new tickets
only, no product-code changes this round.

## Coverage (no silent truncation, §8)

Sentinel: last `Refactoring-Round:` trailer was DH-0241 (closing commit `82feb47`).
Reviewed the range `82feb47..HEAD` on `claude/coordinator-round-2-11240`:

- DH-0242/0243/0244 (round-3's own fixes): CLAUDE.md ADR citations, dead `CLI_RESET` export,
  deduped CI-env-clear function. Spot-checked — clean, nothing lingering.
- DH-0245 (TUI Header A2 becomes persistent in-session): read `RootView.tsx`/`TranscriptPane.tsx`/
  `mount.ts`/`App.tsx` threading. Clean; header rendering routes through the single existing
  `renderHeaderA2`, no duplicated banner logic.
- DH-0129 (web autoscroll undershoot): read `Transcript.tsx` diff. Root cause and fix sound.
  Note: `src/transcript-grouping.ts` actually first landed in *this* commit alongside DH-0246's
  concurrent work — verified it's the single source both clients use (below).
- DH-0246 (TUI tool-call grouping via shared `transcript-grouping.ts`): **focus item — clean.**
  Read the module in full plus both consumers. Both `Transcript.tsx` (line 297) and
  `TranscriptPane.tsx` (lines 56, 155) import `groupTranscript`/`isGroupableToolTurn` from the
  shared module; no residual copy of the maximal-run partitioning survives in either client.
  The `GroupableTurn` structural type correctly avoids coupling to either client's `Turn`, and
  the module carries no Web/DOM-specific leftovers. No ticket.
- DH-0247 (Header B right-border padding): **focus item — found a follow-on, DH-0249.** The
  content-row fix is correct, but the same math error survives on the frame's *top* border
  (top-right `╮` one column right of every other corner), and DH-0247's regression test filters
  to `│`-bearing rows so it never covered the frame's own border lines. Filed DH-0249.
- DH-0248 (Web branded masthead): **focus item — clean.** Read `AppHeader.tsx` + `styles.css`.
  No shareable code duplication with DH-0245's TUI header — the two are genuinely different
  substrates (CSS gradient + `<LogoMark>` SVG vs. ANSI truecolor char-painting), so there's
  nothing to extract into a common module. The deliberate placement divergence (TUI scrolls into
  transcript, Web pins a fixed masthead) **is** recorded discoverably in `docs/design/style-guide.md`
  §6.2 ("brand-launch moment"), lines 328–351, not only in ticket history — the dispatch's
  concern is already satisfied. No ticket.
- Header A2 analogous-bug check (dispatch item): `renderHeaderA2` uses a `├─`/`└─` tree layout
  with no right border, so it has no analogue of DH-0247/DH-0249's corner-drift bug. Nothing to
  file.

## Findings filed

- **DH-0249** (bug, Core): Header B top border is one column too wide — DH-0247's fix and its
  regression test both missed the frame's own border lines.

## Explicitly not filed

- `transcript-grouping.ts` and its two consumers: clean, no residual duplication.
- DH-0245/DH-0248 header pair: no shareable duplication; divergence rationale already in
  style-guide §6.2.
- Header B plain-mode literal inconsistency (`47`/`51` hardcodes vs. color-path `width = 49`):
  noted as an aside inside DH-0249's Assumptions, deliberately not a separate ticket — purely
  cosmetic, plain-mode-only, and only worth touching if DH-0249's implementer is already in the
  file.

## Notes

Closed out by the coordinator with a `Refactoring-Round: DH-0250` trailer commit per the
established convention and the standing owner authorization in
`docs/design/refactoring-round-prompt.md` (2026-07-19 directive).
