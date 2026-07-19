---
spile: ticket
id: DH-0212
type: bug
status: implementing
owner: stefan
resolution:
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
