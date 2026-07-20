---
spile: ticket
id: DH-0230
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0126]
  relates_to: [DH-0126]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0230: TUI rapid scroll produces garbage escape sequences (race condition)

## Summary

DH-0126 ("URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history") was largely resolved, and normal-speed scrolling through chat history works without issue. However, during manual testing (2026-07-19), rapid/aggressive scrolling — firing many scroll events in quick succession — still produces some garbage ANSI escape sequences in the rendered output. This appears to be a **timing/race condition** in the scroll event handler or render cycle, rather than a systemic failure. Much improved over the pre-DH-0126 state, but not fully resolved.

## User Stories

### As an operator, I want rapid scrolling to work without producing garbage escape sequences

- Given the TUI is displaying a chat transcript, when I scroll up rapidly by moving the mouse wheel quickly or holding it down, then the transcript should update smoothly without any visible garbage escape sequences, corruption, or visual artifacts.

## Functional Requirements

1. Identify the root cause of the race condition in the scroll event handler (`src/tui/app.ts` or related scroll-handling code)
2. Synchronize scroll event processing with the render cycle to prevent buffered escape codes from being out of sequence
3. Add rate-limiting or debouncing to scroll events if needed to prevent overwhelming the renderer
4. Ensure garbage sequences never appear, even under extreme scroll velocity

## Assumptions

- The pre-DH-0126 fix partially addressed the issue but left a timing vulnerability
- Scroll events may be firing faster than the renderer can process them, causing escape code sequencing issues
- This is likely a buffering/synchronization problem, not a missing escape-code reset

## Risks

- None beyond the normal risk of touching PTY/ANSI rendering code
- Lower priority than DH-0126 since normal scrolling works; only impacts edge-case aggressive scrolling

## Open Questions

- Does debouncing the scroll handler help, or is the issue deeper in the render pipeline?
- Is the problem in Ink's PTY rendering, or in dh's own scroll event binding?

## Notes

### 2026-07-19 — Manual testing observation

During comprehensive TUI testing, observed that:
- Normal scrolling speed: works perfectly ✅
- High-speed/rapid scrolling (quick mouse wheel or hold): produces occasional garbage escape sequences ⚠️
- Much improved vs. pre-DH-0126 state, but not fully eliminated
- Appears to be a **timing/synchronization issue** rather than a logic error

Scenario: Scroll up rapidly through a long chat transcript using the mouse wheel; some ANSI escape sequences appear corrupted in the visible output.

Related: DH-0126 was marked as resolved/verifying after the initial fix, but this edge case remained unaddressed.

### 2026-07-19 — Root cause found and fixed (Mary)

**Root cause**: not a render-pipeline/Ink-scheduling race, and not a scroll-offset
synchronization gap — it's a raw-input parsing bug at the `stdin` layer, in `src/tui/app.ts`'s
`stdin.on("data", ...)` handler. `src/tui/mouse.ts`'s `parseSgrMouseChunk` /
`stripSgrMouseSequences` (from DH-0126) already handled a mouse sequence being split across
two stdin `data` events *if the split lands at the very end of a chunk* — the trailing partial
gets recognized and dropped. But each chunk was parsed independently: the *continuation*
fragment landing in the *next* `data` event (e.g. `;20M`, missing its `ESC[<` prefix) has
nothing left to identify it as a mouse-sequence remnant. It looks like ordinary text and falls
straight through `parseKeys` into the composer as literal garbage characters — the exact
DH-0126 symptom, but only reachable when one sequence happens to straddle a stdin read
boundary. Normal-speed scrolling rarely hits this (each notch typically arrives whole in one
read); rapid/aggressive scrolling floods the PTY with many back-to-back reports, which makes
straddling a read boundary far more likely.

**Reproduction**: confirmed synthetically — fed the parser a burst of SGR mouse sequences
deliberately split across separate chunk boundaries (mimicking PTY buffering under load); the
pre-fix code left the second chunk's continuation fragment unstripped.

**Fix**: `MouseChunkAssembler` (new class in `src/tui/mouse.ts`) carries an unresolved trailing
partial *forward* across `data` events and prepends it to the next chunk before parsing, so a
split sequence is reassembled and parsed whole regardless of where the boundary lands.
`src/tui/app.ts` now owns one `MouseChunkAssembler` instance per session and feeds it every
stdin chunk in arrival order, instead of calling `parseSgrMouseChunk`/
`stripSgrMouseSequences` directly per chunk.

One deliberate scope limit, found via the real-PTY e2e suite: the "partial" match only
triggers once the full `ESC[<` introducer has arrived (not a bare trailing `ESC`). An earlier
draft that buffered a bare trailing `ESC` as "might be a mouse sequence in progress" broke a
real standalone Escape keypress (a legitimate one-byte `data` chunk on a real PTY) by delaying
it into the next `data` event — caught by `e2e/tui.test.ts`'s real-PTY boot test, not by unit
tests (which use synthetic, non-PTY stdin). This is the answer to the ticket's "does debouncing
help, or is the issue deeper" open question: neither — no debouncing was needed, and the issue
was not in Ink's own render/commit scheduling at all, but in dh's own scroll-event/stdin
binding not surviving a chunk boundary.

**Verification**:
- New regression tests in `src/tui/mouse.test.ts` (`describe("MouseChunkAssembler (DH-0230)")`)
  cover: a sequence split immediately after the introducer, a split anywhere within the digits,
  surrounding non-mouse text preserved on both sides, a burst of 50 rapid notches each arriving
  in its own chunk, an implausibly long unresolved carry being abandoned rather than buffered
  forever, and — the regression this ticket's fix needed a second pass to avoid — a bare
  trailing Escape keypress NOT being buffered/delayed.
- `bun run typecheck`: pass.
- `bun run lint`: pass (biome, no findings).
- `bun run test:coverage`: 100% line coverage overall (`src/tui/mouse.ts` and `src/tui/app.ts`
  both 100% lines on the changed code). One unrelated flake in
  `src/web/client/app.test.ts` under full-suite parallel load (passes standalone, in
  `src/web/` — outside this ticket's scope).
- `bun run e2e`: 41/41 pass against the real compiled binary, including
  `e2e/tui.test.ts`'s real-PTY boot test, which is what caught the Escape-keypress
  regression in the first draft of this fix.
