---
spile: ticket
id: DH-0131
type: bug
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

# DH-0131: Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event

## Summary

Found during live manual testing 2026-07-17 while investigating the owner's failed-agent report: searched every session log from that night's testing and found zero status_change events with status:"failed" anywhere, despite the owner having visually seen one in the agent tree live. The one located real failure case (Root agent failed to start: ...) was logged only as a plain message (role: system), never as a structured status_change:failed event -- meaning the JSONL log, the diagnostics-critical source of truth per CLAUDE.md 4.4/ADR 0004, is missing the failure transition entirely for at least this code path. Needs investigation into every place an agent can reach a failed/stopped terminal state to confirm which ones do/don't emit a proper status_change log line. Core (Grace) / Server (Radia) depending on where the gap actually is -- diagnostics-critical, should be prioritized above the purely cosmetic items in this batch.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — investigation and fix (Core)

Investigated every place an agent can reach a failed/stopped terminal state:

- `src/agent/loop.ts`: `reportStopped()`, the `TASK_FAILED`/self-report failure path, and the
  interactive waiting/running transitions all already pair their `agent_status` SSE event
  with a `status_change` JSONL log line — no gap found there.
- `src/agent/runtime.ts` `spawnAgent()`/`tasks.ts`: sub-agent failures route through
  `loop.ts`'s own `emitLog`, already covered.
- `src/agent/runtime.ts` `runRoot()`: two real gaps found, both harness-error paths that
  bypass `loop.ts` entirely (so `loop.ts`'s own paired emission never runs):
  1. `resolveModel()`/`providerFor()` throwing synchronously before the loop starts (bad/
     unknown model or provider name in config) — previously sat entirely outside
     `runRoot()`'s try/catch, so nothing but a synthetic `agent_status` SSE event
     (constructed ad hoc by `src/cli.ts`'s interactive-mode caller) and a plain `"message"`
     log line (never a structured `status_change`) ever recorded this failure. This is the
     exact case seen live ("Root agent failed to start: ..." logged only as a role:system
     message). The standalone `--instructions`/`--job` path had zero handling for this at
     all — not even a message line.
  2. `runAgentLoop()` itself throwing mid-run (a harness error after the loop's header line
     was already written) — `runRoot()`'s existing catch block emitted only `session_ended`,
     never a `status_change` log line or `agent_status` SSE event.

Fix: widened `runRoot()`'s try/catch to cover model/provider resolution too, and both catch
blocks now emit the same message + `status_change:"failed"` log lines and
`agent_status:"failed"` SSE event (mirroring `loop.ts`'s own paired-emission convention)
before rethrowing. This makes `AgentRuntime` itself the single, authoritative place this is
handled for every caller (interactive TUI/Web/server AND the standalone `--job` path), so
removed the now-redundant hand-rolled duplicate logging `src/cli.ts`'s
`AgentRuntimeLoopAdapter.sendMessage()` used to construct itself (would have double-logged
once `runtime.ts` started emitting this on its own).

Tests added/extended (proving each fixed path, per CLAUDE.md §9):
- `src/agent/runtime.test.ts`: "runRoot emits a status_change:failed log line and an
  agent_status:failed event when model resolution fails before the loop starts".
- `src/cli.test.ts`: "DH-0131: a root agent that fails to start (unknown model in config)
  emits a structured status_change:failed log line, not just a message"; plus a
  `status_change` assertion added to the existing "real provider crash" mid-run test.

Gates run: `bun run typecheck` (pass); `bun run lint` on touched files (clean — repo-wide
lint has 11 pre-existing unrelated errors); `bun test src --coverage` (2112 pass, 0 fail;
changed lines in `src/cli.ts` and `src/agent/runtime.ts` fully covered); `bun run e2e` (13
pre-existing failures reproduced identically on unmodified `main` — tmux-pane-not-found
sandbox issue plus 2 provider-callCount-off-by-one flakes — confirmed via `git stash`,
unrelated to this change).

- 2026-07-19: Manual testing pass (`temp-manual-testing.md`) re-tested live: sub-agent
  failures do visibly appear in the Web tree with a status indicator, confirming the
  user-facing symptom this ticket describes is at least partially addressed. But the tester
  could not confirm from the outside whether the underlying JSONL actually gets a structured
  `status_change` event as this ticket's Functional Requirements specify (that requires
  reading the raw log file, not just observing the UI) — flagged as still needing a direct
  JSONL inspection before this closes, not just a UI spot-check.
