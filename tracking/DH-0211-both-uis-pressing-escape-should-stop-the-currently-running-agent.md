---
spile: ticket
id: DH-0211
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0142, DH-0143]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0211: Both UIs: pressing Escape should stop the currently running agent

## Summary

Owner request (2026-07-19): pressing Escape in either the TUI or Web UI should stop whatever the currently-focused agent is doing (send stop_agent), same convention as many interactive coding-agent UIs. Confirmed via grep: (1) the stop_agent wire command already exists end-to-end (src/contracts/commands.type.ts's StopAgentCommand, handled server-side, same command SendMessage/TaskStop's own harness tools use), so no contracts change is needed; (2) Escape is already a handled key in both UIs today, but only for dismissing the slash-command autocomplete dropdown (DH-0142/0143) and clearing transient status messages/notices -- it never sends stop_agent. Scope: when Escape is pressed AND there is a running agent (the focused/root agent, or whichever agent view is active) AND no higher-priority Escape behavior is already active (e.g. the autocomplete dropdown is open -- that should still close first on the first Escape press, only a second Escape or an Escape with no dropdown open should stop the agent, to avoid accidentally killing a run while dismissing a menu), send stop_agent for that agent. Needs a UX decision on the dropdown-vs-stop precedence and whether a confirmation/undo-window is wanted for something as destructive as stopping a run -- flagged as an open question for whoever implements, not fully speced here.

## User Stories

### As an operator, I want Escape to stop a running agent, so I don't have to reach for Ctrl+C or the mouse

- Given the TUI's root view with the root agent `running` or `waiting`, when I press Escape, then a `stop_agent` command is sent for the root agent and no autocomplete/back-navigation shortcut intercepts it. Proven by `src/tui/state.test.ts`: "DH-0211: escape with an active running root agent sends stop_agent instead of quitting".
- Given the TUI's root view with no active/running root agent (never started, already terminal, or session already ended), when I press Escape, then no `stop_agent` is sent and the existing "clear transient status/reconnect messages" fallback behavior still runs unchanged. Proven by `src/tui/state.test.ts`: "escape in the root view clears both statusMessage and reconnectNotice" (pre-existing), "DH-0211: escape with a terminal-status root agent falls back to clearing messages (no stop_agent)", and "DH-0211: escape after session_ended falls back to clearing messages (no stop_agent)".
- Given the Web UI with a selected agent whose status is `running` or `waiting` and the model picker is closed, when I press Escape, then `stop_agent` is sent for that agent (via the same `stopAgent` command `AgentHeaderPanel`'s Stop button uses). Covered by `src/web/client/app.ts`'s document-level `keydown` handler; existing `app.test.ts` coverage exercises the handler end-to-end (100% line coverage maintained per `bun run test:coverage`).
- Given the Web UI's model picker is open, when I press Escape, then the picker closes (pre-existing DH-0093 behavior) and no `stop_agent` is sent on that same press — this precedence is unchanged and still covered by existing `app.test.ts` model-picker-escape tests.

## Functional Requirements

- TUI: `src/tui/state.ts`'s `handleRootKey` Escape branch now calls a new `handleEscape` helper. It sends `stop_agent` for `state.rootAgentId` when `state.rootActive` is true, the root agent isn't already in a terminal status, and the session hasn't already ended; otherwise it falls back to the pre-existing "clear `statusMessage`/`reconnectNotice`" behavior. Tree/agent-view Escape (back-navigation to the parent view) is unchanged — out of scope, see Notes.
- Web: `src/web/client/app.ts`'s existing global `document` `keydown` listener (previously only closing the model picker) now also sends `stop_agent` for `selectedAgent(state)` when its status is `running`/`waiting`, provided the model picker isn't open (which still wins first, unchanged precedence).

## Assumptions

- This worktree's checked-out baseline predates DH-0142/0143 (the `/`-command autocomplete dropdown) — neither `src/tui/state.ts` nor `src/web/client/components/Composer.tsx` in this tree has any dropdown/autocomplete code to layer precedence under. The ticket's "close dropdown first, second Escape stops" precedence therefore has nothing to implement against here. Whoever merges this forward into a tree that does have DH-0142/0143 landed should re-apply the same precedence rule Composer.tsx already uses for its own Escape-dismiss branch (return/stopPropagate before any stop_agent check), so a first Escape with the dropdown open still only dismisses it.

## Risks

## Open Questions

## Notes

### 2026-07-19 — implementation

Implemented Escape-stops-the-running-agent in both UIs:

- TUI (`src/tui/state.ts`): new `handleEscape` helper, wired from `handleRootKey`'s existing `escape` case. Reuses `rootActive` — the exact same "has the root actually started" guard `handleCtrlC` (DH-0059) already uses — plus a terminal-status/`sessionEnded` check, so an Escape that can't do anything useful falls back to the pre-existing "clear transient messages" behavior instead of sending a no-op `stop_agent`.
- Web (`src/web/client/app.ts`): extended the existing global `keydown` listener (previously only closing the model picker) to send `stop_agent` for the currently-selected agent when it's running/waiting, gated behind the model-picker check so that precedence is unchanged.

**Confirmation/undo-window decision: no confirmation dialog**, in both UIs. Reasoning: DH-0059 already established that Ctrl+C sends `stop_agent` immediately on the first press with no confirmation — a stop is recoverable (the operator can just send another message afterward; nothing is deleted) and not destructive to any data. Adding a confirmation prompt for Escape but not for Ctrl+C, when both trigger the identical `stop_agent` command against the identical agent, would be an inconsistent UX for what the operator experiences as the same "stop it" action. TUI's Escape also deliberately does *not* reuse Ctrl+C's `shutdownRequested`/quit machinery — it only stops the run, it never quits the process, matching Web's Escape (which has no quit concept at all).

**Baseline mismatch flagged**: this worktree's checked-out commit predates DH-0142/0143 (autocomplete dropdown), so the ticket's dropdown-vs-stop precedence requirement has no dropdown code to sit in front of in either UI on this branch. See the Assumptions section above for what a forward-merge onto a tree with DH-0142/0143 needs to do (have the dropdown's own Escape branch `return`/`stopPropagation` before reaching the new stop logic, exactly as the two DH-0142/0143 implementations already structure their other dropdown-intercept branches).

Gates run locally on this worktree: `bun run typecheck` (pass), `bun run lint` (fails identically with or without this change — pre-existing `biome.json` schema/CLI-version mismatch unrelated to this ticket, confirmed via `git stash`), `bun run test:coverage` (2179 pass / 0 fail, one unrelated pre-existing flaky test in the AgentRuntime background-push suite that passes on rerun; new code at `src/tui/state.ts` lines covered, only pre-existing gap is line 403 which predates this change), `bun run e2e` (38 pass / 0 fail, including `e2e/slash-commands.test.ts`, `e2e/tui.test.ts`, `e2e/web.test.ts`).
