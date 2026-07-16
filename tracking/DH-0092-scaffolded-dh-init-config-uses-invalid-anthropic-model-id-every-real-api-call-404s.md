---
spile: ticket
id: DH-0092
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0092: Scaffolded dh init config uses invalid Anthropic model id, every real API call 404s

## Summary

Live repro (2026-07-16, real Anthropic API): SAMPLE_DH_JSON in src/cli.ts (and README's copy) sets the anthropic model config's model field to sonnet-5, which is not a real Anthropic API model id -- every completion request 404s (model: sonnet-5 not_found_error), silently ending the session (root agent failed to start) with no visible reply in the TUI. The real model id is claude-sonnet-5. Found by the owner testing a fresh dh init scaffold end-to-end (typed ping, got nothing back).

## User Stories

### As a first-time operator running `dh init` then chatting with the agent, I want the scaffolded config to actually work against the real API

- Given a fresh `dh init` scaffold with a real `ANTHROPIC_API_KEY`, when the operator sends
  a message, then the model actually responds — not a silent session failure.

## Functional Requirements

- `src/cli.ts`'s `SAMPLE_DH_JSON`: change `"model": "sonnet-5"` to `"model":
  "claude-sonnet-5"` (the real Anthropic API model id). Already fixed and verified live.
- README's copy of the sample config: same fix, already applied.

## Resolution

Fixed directly by the coordinator (2026-07-16) — small, unambiguous, confirmed via a real
live end-to-end test: `dh init` → `dh --env secrets.env` → sent "ping" → got a real reply
("Pong! ...") with real token/cost tracking, versus the prior behavior (session silently
ended, exit 2, root agent failed to start, 404 from Anthropic). All quality gates
(typecheck/lint/test:coverage, 1659/1659 tests) verified clean after the fix.

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner testing a fresh build end-to-end — typed "ping" into the
> TUI and got no reply. Root-caused via the session's own JSONL log
> (`agent-root.jsonl`'s `"Root agent failed to start: ... 404 ... model: sonnet-5"` line),
> not guessed at.
