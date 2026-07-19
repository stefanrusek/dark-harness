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

## Markdown Rendering in Web UI

### DH-0109: GFM table rendering
- **Status: PARTIALLY VERIFIED** ✅ Web / ❌ TUI
- Web UI: Tables render as real HTML tables (not literal pipe text) ✅ CONFIRMED
- Table alignment works correctly ✅
- Tested with 8-planet data table and comprehensive markdown test
- Setext-style headings and reference-style links implemented per ticket
- **TUI rendering unverified:** TUI doesn't run in current environment

### Markdown Rendering Issues (Web UI)

1. **Headers H3-H6 all look the same** — only main (H1) and sub (H2) have distinct styling
   - All smaller headers render identically
   - Should have visual hierarchy

2. **Link with title attribute broken** ⚠️
   - `[text](url "title")` syntax puts the title into the href attribute
   - Should either render title as tooltip or ignore it gracefully
   - Related to DH-0109 reference links feature

3. **Inline HTML not supported**
   - `<span style="color: red;">text</span>` doesn't render
   - **Suggestion:** Basic `<span style="color: ...">` should be safe and work in both Web and TUI
   - Could enable simple inline coloring without full HTML support

4. **Escaped characters show their backslashes** ⚠️
   - `\*` renders as `\*` instead of `*`
   - Escaping mechanism not working

### Markdown Rendering Working ✅

- Tables (basic, with alignment)
- Nested blockquotes
- Code blocks with syntax highlighting
- Lists (ordered, unordered, nested, mixed)
- Bold, italic, strikethrough
- Reference-style links (resolution works)
- Setext-style headings (H1/H2)
- Thematic breaks

### Overall Assessment

Much improved from previous state! Most features work correctly. Main gaps are:
1. Header hierarchy (visual distinction)
2. Link title attributes
3. Escaped character rendering
4. Limited inline HTML (basic color support would help)

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

## Automated Testing Results

### ✅ Tool Error Handling
- **Read tool on missing file:** Returns clean error `"file does not exist: /path"`
- **Edit tool on missing file:** Returns clean error, doesn't create the file
- **Agent with empty prompt:** Rejected with validation error `"prompt must be a non-empty string"`
- **Result:** Tool errors are caught gracefully, don't crash the agent

### ✅ Concurrent Operations
- Spawned 3 background Bash tasks concurrently
- All completed successfully without interference
- Tasks interleaved output correctly (not serialized)
- **Result:** Concurrent operations work reliably

### ✅ Large File/Output Handling
- Created 1MB file with Read tool
- Read tool works with `limit` and `offset` parameters (paginated reads)
- **Result:** Large files handled gracefully, no memory explosion observed
- Note: DH-0014 ("unbounded memory") may not be an actual issue in practice

### ⚠️ Sub-agent Error Reporting
- First sub-agent test: Tool error handled correctly, but agent then failed looking for non-existent `ReportOutcome` tool
- Second sub-agent test: Same pattern — agent doesn't know how to report completion
- **Finding:** Sub-agents may struggle with terminal/final status reporting (not documented in their toolset)

## Web UI Bugs Found

### Issue 3: Viewing sub-agent erases pending operator message ⚠️
- **Bug:** Type a message in the input box, then click to view a sub-agent detail
- The typed (pending) message disappears from the input box
- **Impact:** User loses unsent message, must retype
- Should preserve pending input when switching agent views
- Related to message queue/state management

## Manual Testing Results

### Sub-agent Tree Updates ✅
- Sub-agents appear in the tree in real-time
- Status indicators show clearly (e.g., "agent failed")
- Clicking on a sub-agent shows its messages
- **Result:** Tree updates work nicely!

### Session Reconnect ✅ (With Issues)
- Reconnecting after page reload works — messages are preserved ✅
- **But:** Should automatically scroll to latest message after downloading full log
- Currently requires manual clicks on "Jump to Latest" button to get to bottom
- **Related to DH-0129 autoscroll issues** — same scroll-to-bottom logic problem
- The event stream reconnect works (`Last-Event-ID`), but UX is clunky

### Error Display in Web UI
- Unclear what the expected visual treatment is — need design guidance
- Currently sub-agent failures show an indicator and "agent failed" status
- May need distinct error styling (color, icon, formatting) to distinguish from normal messages

### Sub-agent Failure Logging (DH-0131)
- Sub-agent failures do appear in the tree with status indicator
- Are they logged as structured `status_change` events in the JSONL? (Unclear — ticket says they're not)
- The visible tree behavior works, but backend logging may be incomplete

## Potential Areas to Test (Not Yet Explored)

### Agent-side Features

1. **Sub-agent spawning and communication**
   - Can spawn sub-agents with `Agent` tool ✅ (we did this)
   - `SendMessage` to running sub-agents — partially tested but could be more thorough
   - Background task tracking via `Monitor` — works but could test edge cases
   - What happens if a sub-agent crashes/errors? Are those properly logged?

2. **Tool error handling**
   - What happens when a tool fails (e.g., Read on non-existent file)?
   - Do errors bubble up cleanly or cause agent to stop?
   - Are tool timeouts handled gracefully?

3. **Concurrent operations**
   - Multiple background `Bash` tasks running simultaneously
   - Multiple sub-agents spawned at once
   - Does the message queue (DH-0140) handle interleaving correctly?

4. **Large file/output handling**
   - Does `Read` work on very large files?
   - What about `Bash` commands with huge output?
   - DH-0014 tracks "unbounded memory for large files" — is this an issue?

5. **Slash commands** (Web UI)
   - Does Web UI support slash-command autocomplete? (DH-0195 mentions this is missing)
   - What slash commands are available?

### Web UI Integration

1. **Real-time sub-agent tree updates**
   - When you spawn a sub-agent, does it appear in the tree immediately?
   - Do status changes propagate live to the UI?
   - Does the tree collapse/expand smoothly?

2. **Token/cost tracking**
   - Does the Web UI show token usage per turn?
   - Does it show estimated/actual costs?
   - Is this tracked correctly across sub-agent calls?

3. **Session management**
   - Can you restart/reload the page mid-conversation?
   - Does `Last-Event-ID` reconnect work smoothly?
   - Are old messages preserved or lost on reconnect?

4. **Input validation**
   - What happens if you send an empty message?
   - Very long messages?
   - Special characters in the input?

5. **Error display**
   - When a tool errors, how is it shown in the Web UI?
   - Are error messages formatted/styled distinctly?
   - Can you tell the difference between agent errors vs. tool errors vs. harness errors?

### Known Suspects (From Tickets)

- **DH-0131:** Sub-agent failure transitions not logged as structured events
- **DH-0140:** Message queue mid-turn events orphaned (we validated queuing works, but...)
- **DH-0145:** TUI app.test.ts fails (yoga layout WASM init race) — probably not web-related
- **DH-0195:** README missing `--web-port`, `--host`, `--import`/`--model` flags
- **DH-0139:** `--web` doesn't work remotely out of box (LAN IP rejection) — we fixed DH-0128 but check if config/binding is right

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
