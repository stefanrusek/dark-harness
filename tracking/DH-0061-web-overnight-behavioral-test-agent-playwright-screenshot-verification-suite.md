---
spile: ticket
id: DH-0061
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

# DH-0061: Web overnight behavioral test agent: Playwright screenshot verification suite

## Summary

Build a haiku-sub-agent-runnable test plan + prompt set that drives the real compiled Web UI via Playwright (real browser, visual screenshot captures), covering every implemented behavior and every UI-testable ticket. Modeled on the owner's proven overnight-verification technique used successfully with Fable once already (too expensive to repeat per-run) - this session's fleet methodology should drive it instead. Sister ticket to DH TUI test agent (tmux-based).

## User Stories

### As the owner, I want a haiku sub-agent to autonomously drive the real Web UI overnight and verify it behaves the way I would check it myself in the morning

- Given a long-running unattended implementation session, when it finishes, then a haiku
  sub-agent can run a fixed set of prompts against the real compiled binary's served Web UI
  (via Playwright, already a project devDependency per `e2e/connect-web.test.ts` and DH-0046's
  design) and report pass/fail per behavior with visual screenshots as evidence, without a
  human needing to click through each one by hand.

## Test Plan (feature list to verify)

**Core implemented Web behaviors:**
- Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.
- Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and
  updates live as an agent transitions.
- Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).
- Transcript shows both the user's own sent messages and the assistant's responses, clearly
  delineated.
- Token/cost figures display per-agent and as a session total, and accumulate correctly across
  multiple turns (DH-0028's Web side was already correct; verify it still is).
- SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect
  indicator, then resumes without duplicating or losing transcript content (DH-0024).
- Log download works and produces a valid file.
- Multi-turn conversation: sending a second message after the agent pauses (waiting) continues
  the same conversation, not a fresh one.

**Ticket-driven Web behaviors (verify the fix actually shipped, not just unit tests):**
- **DH-0056**: assistant output renders real HTML formatting (headings, bold, italic, inline
  code, fenced code blocks, lists, links) via sanitized DOM — never raw Markdown syntax
  characters, never raw HTML interpreted from model output, links open safely
  (`rel="noopener noreferrer"`, non-http(s)/mailto schemes rejected).
- **DH-0029**: keyboard-only navigation can reach the agent list (Tab-reachable, visible focus
  state); ARIA live regions announce status changes (verify via accessibility tree snapshot,
  not just visual); a "stopped" status has a distinct color from "failed"/"done"; errors
  persist in a visible history rather than disappearing after a few seconds.
- **DH-0023**: CORS/CSP/clickjacking headers are present on responses (verify via network
  inspection, not just visually).
- **DH-0044** (once implemented): a long assistant turn's text visibly streams incrementally
  rather than appearing all at once when the turn completes.
- **DH-0012**: this can't be visually verified in a short session (it's a 50-entry eviction
  threshold) — note as out-of-scope for this suite, covered by unit tests instead.

## Functional Requirements

- Each test prompt must be self-contained: build the real binary fresh (or use an
  already-built one, implementer's call), launch it serving the Web UI against the mock
  provider (reusing `e2e/support/mock-provider.ts` conventions), drive it with Playwright
  (clicks/keystrokes/network assertions), capture a screenshot, and assert on the page state —
  no reliance on internal knowledge only a human tester would have.
- Prompts must be runnable by a haiku-tier sub-agent with no additional context beyond the
  prompt itself and this repo — self-contained, per PLAYBOOK.md's persistent-vs-anonymous
  dispatch guidance (these are anonymous, single-shot verification runs).
- A failing prompt must produce a clear, specific pass/fail signal plus the screenshot as
  evidence (not just "something looked wrong").

## Notes

> [!NOTE]
> Owner-proposed technique (2026-07-15): previously done manually once with Fable directly
> driving verification — too expensive to repeat per overnight run. This ticket + its sister
> **DH-0060** (TUI) exist so the fleet's existing methodology can produce and re-run this
> verification cheaply (haiku-tier) instead of re-spending an architect pass every time.
> **Routed to the architect (Fable) for a real design pass** — per the owner's explicit
> request, Fable should write actual spike scripts (real, runnable prompt/harness examples)
> and attach them to this ticket so the implementing agent has a proven pattern to extend,
> not just a written plan.
