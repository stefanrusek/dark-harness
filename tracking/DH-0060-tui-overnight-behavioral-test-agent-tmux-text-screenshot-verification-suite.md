---
spile: ticket
id: DH-0060
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress (spikes)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0060: TUI overnight behavioral test agent: tmux text-screenshot verification suite

## Summary

Build a haiku-sub-agent-runnable test plan + prompt set that drives the real compiled TUI via tmux (real PTY, text-screenshot captures via capture-pane), covering every implemented behavior and every UI-testable ticket. Modeled on the owner's proven overnight-verification technique used successfully with Fable once already (too expensive to repeat per-run) - this session's fleet methodology should drive it instead. Sister ticket to DH web test agent (Playwright-based).

## User Stories

### As the owner, I want a haiku sub-agent to autonomously drive the real compiled TUI overnight and verify it behaves the way I would check it myself in the morning

- Given a long-running unattended implementation session, when it finishes, then a haiku
  sub-agent can run a fixed set of prompts against the real compiled binary (via the existing
  `e2e/support/tmux-pty.ts` PTY harness — real terminal, `tmux capture-pane` for "text
  screenshots") and report pass/fail per behavior, without a human needing to sit at a
  terminal checking each one by hand.

## Test Plan (feature list to verify)

**Core implemented TUI behaviors:**
- Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.
- Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and
  updates live as an agent transitions.
- Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).
- Transcript shows both the user's own sent messages and the assistant's responses, clearly
  delineated (DH-0007-era structured transcript).
- Token/cost figures display per-agent and as a session total, and accumulate correctly across
  multiple turns (DH-0028).
- SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect
  indicator, then resumes without duplicating or losing transcript content (DH-0024).
- Log download/export command works and produces a valid file.
- Multi-turn conversation: sending a second message after the agent pauses (waiting) continues
  the same conversation, not a fresh one.
- `TASK_FAILED`/structured-outcome self-report is reflected in the UI's final status marker.

**Ticket-driven TUI behaviors (verify the fix actually shipped, not just unit tests):**
- **DH-0056**: assistant output renders real Markdown formatting (headings, bold, italic,
  inline code, fenced code blocks, lists, links) via ANSI — never raw Markdown syntax
  characters, never a raw/garbled escape sequence.
- **DH-0025**: wide characters (CJK, emoji, combining marks) wrap/pad correctly without
  corrupting the frame; resizing the terminal rapidly doesn't flicker/corrupt; no visible
  full-redraw flicker on the once-per-second idle tick.
- **DH-0026**: input box supports cursor movement (arrow keys, home/end), and previously-dead
  keys now work.
- **DH-0027**: the agent tree view scrolls to keep the selected/highlighted entry visible as
  you navigate a tree taller than the visible pane.
- **DH-0059**: Ctrl+C in local mode (server+TUI same process) stops the agent and exits
  cleanly with the correct exit code; a second Ctrl+C or the fallback timer force-quits if the
  first doesn't complete promptly.
- **DH-0044** (once implemented): a long assistant turn's text visibly streams incrementally
  rather than appearing all at once when the turn completes.
- **DH-0012**: this can't be visually verified in a short session (it's a 50-entry eviction
  threshold) — note as out-of-scope for this suite, covered by unit tests instead.

## Functional Requirements

- Each test prompt must be self-contained: build the real binary fresh (or use an
  already-built one, implementer's call), launch it under `tmux` via the existing PTY harness
  conventions in `e2e/support/tmux-pty.ts`, drive it with realistic keystrokes/mock-provider
  responses, capture the pane, and assert on the captured text — no reliance on internal
  knowledge only a human tester would have.
- Prompts must be runnable by a haiku-tier sub-agent with no additional context beyond the
  prompt itself and this repo — self-contained, per PLAYBOOK.md's persistent-vs-anonymous
  dispatch guidance (these are anonymous, single-shot verification runs).
- A failing prompt must produce a clear, specific pass/fail signal (not just "something looked
  wrong") — e.g. "expected fenced code block content to render without a leading '```'
  character; captured pane shows: <text>".

## Notes

> [!NOTE]
> Owner-proposed technique (2026-07-15): previously done manually once with Fable directly
> driving verification — too expensive to repeat per overnight run. This ticket + its sister
> **DH-0061** (Web) exist so the fleet's existing methodology can produce and re-run this
> verification cheaply (haiku-tier) instead of re-spending an architect pass every time.
> **Routed to the architect (Fable) for a real design pass** — per the owner's explicit
> request, Fable should write actual spike scripts (real, runnable prompt/harness examples)
> and attach them to this ticket so the implementing agent has a proven pattern to extend,
> not just a written plan.
