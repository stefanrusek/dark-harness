---
spile: ticket
id: DH-0212
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0027, DH-0059, DH-0024, DH-0191, DH-0184, DH-0185]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0212: DH-0060 TUI spike suite regressed from 16/0 to 9/7 pass/fail -- needs real triage before treating as regressions

## Summary

Live TUI testing session (2026-07-19) ran the full DH-0060 orchestrator (e2e/spikes/tui/run-all.ts) and found 7 hard FAILs where a prior run reported 16 PASS / 0 FAIL. Reproduced independently by the coordinator on a genuinely clean, current tree (not a mid-merge artifact) -- same 7 failures both times, so this is real and reproducible, not a fluke of one run. However, per the owner's explicit caution ('take all findings with a grain of salt'), this ticket does NOT assume all 7 are real functional regressions -- initial spot-checking found internal contradictions suggesting several are spike-harness timing/assertion issues rather than actual bugs: test #12 (tree-scroll)'s own captured evidence clearly shows multiple sub-agent tree entries rendering correctly ('Helper 0' through 'Helper 4'), directly contradicting test #8/#9 (agent-tree-hierarchy)'s claim that 'no non-root entry ever appeared' -- same underlying tree-rendering feature, opposite verdicts from different spike scripts, strongly suggesting #8/#9 has a race/timing bug in ITS OWN script (asserting before the sub-agent spawn completes) rather than the tree rendering itself being broken. Similarly #6/#7 (DH-0059 Ctrl+C, status glyph) and #15 (SSE reconnect status) both fail on 'a specific transient status glyph/state was never captured in a text screenshot' -- plausibly the spike's poll cadence missing a fast transition, especially since DH-0184/0185 (shared SSE transport) and DH-0191 (SGR/status-color consolidation) both landed this session and could have changed exact timing or byte sequences the spikes assert on literally.\n\nThe 7 failures, verbatim from e2e/spikes/tui/REPORT.md:\n6. DH-0059 Ctrl+C: cyan waiting-status glyph (\x1b[36m\u25cf) never appeared before Ctrl+C fired.\n7. Same underlying check as #6 (status waiting/cyan half) -- same root cause, listed as separate Test Plan item.\n8. Agent tree hierarchy: 'no non-root entry found' after spawning a sub-agent -- contradicted by #12's own evidence (see above).\n9. Same underlying check as #8 (status done/green half) -- same script, same likely root cause.\n12. DH-0027 tree-scroll: selection marker stayed visible through every Down press; root entry never scrolled out of view after 15 Down presses despite the pane clearly containing 5+ child entries in the captured evidence -- this one's evidence directly shows the scroll-follow logic not engaging even though the tree content itself is correct, so this may be a REAL regression in DH-0027's viewport-follows-selection behavior, not just a timing issue -- distinguish from the timing-suspect ones above.\n14. DH-0025 wide-character wrap/pad: not yet individually inspected.\n15. SSE reconnect: connection-status indicator never showed connecting/closed/error in the title bar during the kill window, though the reconnect notice and content-preservation checks all passed -- same transient-glyph-timing pattern as #6/#7.\n\nNeeds a real investigation pass: for EACH of the 7, determine (a) is the spike script's assertion itself stale/racy (fix the spike, not product code), or (b) is there a genuine product regression (fix product code) -- do not blanket-fix all 7 the same way. #12 (tree-scroll) looks like the strongest candidate for a real regression given its own evidence; #6/#7/#8/#9/#15's transient-glyph pattern looks like the strongest candidate for spike-harness timing issues; #14 is unassessed.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-19 — triage complete, 6/7 were spike bugs, 1 real product bug split off

Went through each of the 7 failures individually — re-ran the exact spike script in
isolation, read its assertion against the real current rendering code, and where the
verdict was ambiguous, wrote a throwaway debug script driving the same tmux session with
extra instrumentation to see the actual byte sequence / timing. Verdicts:

- **#6/#7 (Ctrl+C waiting/cyan glyph)** — spike bug. `spike-ctrlc-exit-code.ts` hardcoded
  `\x1b[36m●\x1b[39m` (cyan). DH-0100 (an earlier, already-landed commit, not this
  session's DH-0184/0185/0191) recolored "waiting" from cyan to yellow/amber
  (`STATUS_TOKENS.waiting.sgr === "33"` in `src/design-tokens.ts`) — the spike's literal
  was just never updated to match. The `\x1b[39m` reset byte was actually still correct
  (`tmux capture-pane -e` re-serializes SGR state from its own model, not the raw wire
  bytes — a foreground-only color run always comes back as a foreground-only reset
  regardless of whether the renderer emitted a full `\x1b[0m` or not). Fixed: derive the
  color code from `STATUS_TOKENS.waiting.sgr` instead of a second hardcoded literal.
- **#8/#9 (agent tree hierarchy)** — spike bug, confirmed race. `pane` (used for the
  childLine/childIndent assertions) was captured once, right when "agent-root" first
  appeared — trivially instant since the tree-fetch round-trip already resolves before the
  child row paints — and never re-polled before asserting. A *separate* poll a few lines
  later (for the green "done" glyph) waited up to 5s and did see the child, proving the
  underlying tree rendering was fine the whole time; only the assertion's own timing was
  wrong. This directly confirms the ticket's own hypothesis (#12's evidence contradicting
  #8/#9). Fixed: wait for the child's own description text before reading `pane`, same
  poll pattern as spike-tree-scroll.ts. Also fixed a second, independent stale literal in
  the same file: `DONE_GLYPH_PREFIX` used `\x1b[32m●\x1b[39m` — sgr 32 ("done") was
  already correct, no fix needed there beyond deriving it from `STATUS_TOKENS.done.sgr`
  for future-proofing.
- **#12 (DH-0027 tree-scroll)** — spike bug, NOT a real regression, despite looking like
  the strongest regression candidate. Root cause: `markerAlwaysVisible` checked
  `line.startsWith("> ")`, but DH-0095's 1-char frame margin means every row actually
  renders as `" > ..."` (leading space) — the check never once matched, so the loop's
  `break` on first failure fired after the very first Down press, meaning only 1 of the
  intended 15 Down presses ever got sent. Manually replayed all 15 Down presses against
  the real binary (outside the spike, via a throwaway debug script) and the tree scrolled
  correctly every time — selection followed, root scrolled out of view exactly as DH-0027
  specifies. Fixed: match `.includes("> ")` instead of `.startsWith("> ")`.
- **#14 (DH-0025 wide-character wrap/pad)** — genuine product bug, isolated and split off
  as **DH-0214** (TUI domain, ready). Not a stale-spike issue: a string containing a
  precomposed accented character immediately followed by an extra Unicode combining mark
  (`café` + U+0301, rendering as `café́`, two accents stacked on one `e`) reliably causes
  the TUI to drop the very next character after that cluster — confirmed via minimal
  repro (`café done.` renders fine with the period; `café́ done.` renders as `café́ done`
  with the period silently gone). Plain combining marks, CJK, and emoji in isolation do
  NOT reproduce it. `src/tui/width.ts`'s own `charWidth`/`stringWidth` compute this
  correctly (0-width for the combining codepoint) — the miscount happens somewhere
  downstream in the Ink/Yoga render path, not in the shared width module, so this needs
  real investigation rather than a quick fix in this pass. Spike left failing/unchanged;
  it's correctly reporting a real bug.
- **#15 (SSE reconnect status)** — two independent spike bugs, both fixed, both
  confirmed via a throwaway debug harness with extra console logging around the affected
  steps:
  1. The connection-status regex `/—\s+(connecting|closed|error)\b/` was checking for
     words ("closed", "error") that don't exist anywhere in the actual connection
     vocabulary (`src/design-tokens.ts` `CONNECTION_TOKENS`: `connecting…` /
     `reconnecting…` / `disconnected`), and even the one real word it did check
     ("connecting") could never match because the title bar renders a spinner glyph
     between the em dash and the label for pending states (`— ⠙ connecting…`), which
     `\s+` doesn't cover. Fixed: match the real label words directly.
  2. Separately (and more impactfully — this was silently masked by variant of the fix
     above during investigation): a rebase artifact had dropped the actual `server.kill()`
     call that's supposed to kill the first server mid-test — the first server was never
     killed, so every attempt to bind a second server to the same port failed with
     "port in use" for the entirely mundane reason that the *original* server was still
     running. Restored the `server.kill()` call and added a bounded rebind-retry loop
     (waits for the killed process to actually exit, then retries the same-port bind a
     few times with backoff) as defensive hardening against real TCP TIME_WAIT delays
     on a port that briefly held a live SSE connection — same-port reuse is load-bearing
     here since the client's reconnect loop retries the same host:port, so a fresh port
     would stop testing the real reconnect path.

**Final DH-0060 orchestrator result: 19 items, 18 PASS(-equivalent) / 1 hard FAIL** (up
from the prior 16/0 baseline in raw pass count, though the comparison is apples-to-oranges
since this run also includes the 2 Mode B heuristic-driven scenarios the earlier 16/0
figure may not have covered the same way). The 1 remaining FAIL is DH-0214 (real bug, not
this ticket's fault to fix). Re-ran `bun e2e/spikes/tui/run-all.ts` twice more after the
fixes landed to confirm stability — same 18/1 result both times, no flakiness introduced.

Files touched (all `e2e/spikes/tui/`, no product `src/` code changed):
`spike-ctrlc-exit-code.ts`, `spike-agent-tree-hierarchy.ts`, `spike-tree-scroll.ts`,
`spike-sse-reconnect.ts`. `bun run typecheck` and `bun run lint` both clean.
`test:coverage`/`e2e` (the standard gated suites, separate from these DH-0060 spikes)
untouched by this change and not re-run since no product code changed.

Follow-up ticket: **DH-0214** — TUI: precomposed accented char + extra combining mark
drops the next rendered character (status: ready, owner: TUI domain / Mary).
