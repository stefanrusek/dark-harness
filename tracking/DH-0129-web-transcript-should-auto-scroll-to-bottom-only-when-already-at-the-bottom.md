---
spile: ticket
id: DH-0129
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0129: Web transcript should auto-scroll to bottom only when already at the bottom

## Summary

Owner request 2026-07-17: standard chat-UI scroll behavior -- the Web transcript should auto-scroll to the bottom as new output streams in, but only if the operator is already scrolled to the bottom. If they've scrolled up to read earlier history, new output should not yank them back down. Web domain (Susan).

## User Stories

### As an operator watching a running agent, I want the transcript to keep pace with streamed output automatically

- Given the transcript scroll region is at (or within a small threshold of) the bottom, when new output streams in (a new turn, or the current turn's text growing), then the region auto-scrolls so the new content is visible and the jump-to-latest button stays hidden.
  - Proven by: `src/web/client/components/Transcript.test.tsx` — "auto-scrolls to the bottom when new content arrives while already near the bottom".
- Given the operator selects a different agent (or a new agent becomes selected), when its transcript renders, then the view scrolls to that agent's bottom immediately.
  - Proven by: the `agentChanged` branch in `Transcript.tsx`'s scroll effect; exercised indirectly whenever a test renders a freshly-selected agent (e.g. "renders assistant output as markdown-parsed turn text"). No dedicated multi-agent-switch test exists — see Open Questions.

### As an operator reading earlier history, I want new output to not yank my scroll position

- Given the operator has scrolled up away from the bottom (beyond the near-bottom threshold), when new output streams in, then the scroll position does not move and a "Jump to latest" button becomes visible instead.
  - Proven by: `src/web/client/components/Transcript.test.tsx` — "reveals the jump-to-latest button when new content arrives while scrolled away from the bottom".
- Given the jump-to-latest button is visible, when the operator clicks it, then the view scrolls to the bottom and the button hides again.
  - Proven by: `src/web/client/components/Transcript.test.tsx` — "clicking jump-to-latest scrolls back to the bottom and hides the button"; `JumpToLatestButton.test.tsx` — "clicking invokes onClick".
- Given the jump-to-latest button is visible, when the operator manually scrolls back to (or within threshold of) the bottom themselves, then the button hides.
  - Proven by: `Transcript.tsx`'s `onScroll` handler (`isNearBottom() && setJumpVisible(false)`); exercised transitively by the "clicking jump-to-latest…" test's scroll-to-bottom assertion. No test drives a raw scroll event distinct from a button click — see Open Questions.

## Functional Requirements

- The transcript scroll region tracks whether it is "near the bottom" using a fixed pixel threshold (`NEAR_BOTTOM_THRESHOLD_PX`, currently 48px) rather than requiring an exact match, so minor rendering/rounding differences don't defeat auto-scroll.
- Auto-scroll re-evaluation is triggered by any transcript-affecting change: agent identity change, turn count change, or a change in the last turn's rendered text length (covers streamed chunks that extend the current turn without adding a new one).
- Switching the selected agent always scrolls to that agent's bottom (no near-bottom check) — it's a fresh view, not a continuation of the current scroll position.
- When not near the bottom and new content arrives, the jump-to-latest button becomes visible instead of forcing a scroll; clicking it scrolls to the bottom and clears the flag.
- Manually scrolling back within the near-bottom threshold clears the jump-to-latest flag even without clicking the button.

## Assumptions

- "At the bottom" is treated as "within `NEAR_BOTTOM_THRESHOLD_PX` (48px) of the bottom," matching standard chat-UI behavior and the existing `JumpToLatestButton` design intent — not pixel-exact.

## Risks

- None identified beyond normal DOM/jsdom scroll-property quirks, already worked around in tests via `Object.defineProperty`.

## Open Questions

- None blocking. Two secondary paths (agent-switch scroll reset, and manual-scroll-back distinct from clicking the button) are exercised only indirectly by other tests rather than dedicated cases — acceptable given they're single-branch and already covered transitively, but flagged here per §9 discipline.

## Notes

- 2026-07-17: Authored real User Stories/Functional Requirements (were TODO placeholders). Implementation was already present, landed as part of DH-0135's React migration (see the DH-0129 comment block atop `Transcript.tsx`), and already reuses `JumpToLatestButton.tsx` rather than duplicating scroll-tracking logic. Added two missing component tests to close the §9 test-coverage gap: auto-scroll-when-near-bottom, and click-jump-to-latest-scrolls-to-bottom. Moving to verifying.
