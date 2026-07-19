# Manual Testing Notes

## Web UI Issues

### Issue 1: Web autoscroll incomplete after operator messages ⚠️
- **Root cause identified:** When the operator sends a message, autoscroll DOES fire — but not all the way to the bottom
- The new message pushes content down, and autoscroll partially follows but stops short
- **The real bug:** Autoscroll should scroll the full distance to put the latest message at the bottom
- The feature works but undershoots on operator messages; agent messages appear to work correctly
- **Also affects tool calls:** Tool calls may not be autoscrolling either
- Related ticket: [DH-0129](tracking/DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md)

### Issue 2: "Jump to Latest" button doesn't appear after mouse wheel scroll ⚠️
- When you scroll with the mouse wheel, the "Jump to Latest" button disappears
- But when an operator message pushes the transcript, the button correctly reappears
- Inconsistency: button should appear in both cases (wheel scroll + message received)
- Related to Issue 1 — probably the same state-management bug

## Web UI Feature Gaps

### Tool call grouping and display ⚠️
- **Missing feature:** Consecutive tool calls with no agent or operator turn between them should be grouped into a collapsible expando (collapsed by default)
- **Missing feature:** Clicking a tool call should show both its input and output together
- Current behavior: tool calls appear individually, hard to see full input/output context
- Improves readability during multi-tool sequences

## TUI Issues

### Issue 1: TUI doesn't run ⚠️
- The TUI mode (`dh` without `--web`) fails to start or crashes
- Blocks all TUI testing and verification
- Related tickets: [DH-0124](tracking/DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md), [DH-0125](tracking/DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md), [DH-0126](tracking/DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md)

## Agent / Message Queue Testing

### Pending messages queuing works! ✅
- Queued 5 messages during a sleep period: `a, b, d, c, d`
- **Agent successfully resumed and processed them** — the harness came back from the blocking read!
- However: the script hung waiting for input indefinitely (no explicit EOF or message-count limit)
- **Implication:** Message queuing infrastructure itself is working, but lacks proper completion signaling
- Related ticket: [DH-0140](tracking/DH-0140-agent-message-queue.md) — agents need structured incoming-event message queue with proper termination semantics

### UX Gaps for Queued Messages ⚠️
- **Visual feedback missing:** Queued messages should show up in the UI as "queued" (different state from sent)
  - Helps users understand what's pending vs. what's already been transmitted
  - Reduces confusion if agent is processing / sleeping
- **Delete capability missing:** Each queued message should have a delete/remove button
  - Users can cancel messages they didn't mean to send or want to retract
  - Improves control and reduces accidental submissions

## Fixed Issues ✅

### DH-0128: Web UI remote reconnection
- **Status: FIXED** (confirmed by recent work)
- Web UI connecting from a separate machine no longer sticks on 'Reconnecting...'

### DH-0109: GFM table rendering
- **Status: IMPLEMENTED** (per ticket notes 2026-07-17)
- Tables should render as real tables in both TUI and Web (not literal pipe text)
- Setext-style headings and reference-style links also implemented
- **Test result:** Created a planet table and it rendered correctly in markdown output
- **Cannot test TUI directly:** TUI doesn't run in current environment
- **Web test pending:** Need to send a table via agent message and verify Web renders it as HTML table (not pipes)

### DH-0122: Application header on every run
- **Status: PARTIALLY BROKEN** ⚠️
- Per ticket notes (2026-07-17): should show logo, version, build identity, and config-status line on CLI, TUI, Web, and doctor
- **Web is missing the app header** — it should be visible but isn't
- Ticket claims implementation is done, but clearly not showing up in the web UI
- **Cannot test TUI directly:** TUI doesn't run in current environment

## Tickets Ready for Testing (Next Agent)

- **[DH-0125](tracking/DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md)** — TUI status row (model, progress, git branch/path) — **requires TUI to work**
- **[DH-0124](tracking/DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md)** — TUI empty state friendliness — **requires TUI to work**
- **[DH-0131](tracking/DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md)** — Sub-agent failure logging — **potentially testable with --web if a sub-agent can be made to fail**
- **[DH-0140](tracking/DH-0140-agent-message-queue.md)** — Message queue and pending-message UX — **partially validated (queuing works), UX gaps identified**

## Blockers for Further Testing

- **TUI doesn't run** — This is the primary blocker. Until TUI is fixed, we can't verify:
  - DH-0122 (header in TUI)
  - DH-0124 (empty-state messaging)
  - DH-0125 (status row)
  - DH-0126 (mouse scroll behavior)
  - Any other TUI-specific features

---

*Last updated: 2026-07-19*
*For other agents to pick up these findings during manual testing sessions*
