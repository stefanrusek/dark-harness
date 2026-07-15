---
spile: ticket
id: DH-0011
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0011: No SIGTERM/SIGINT handling anywhere, and Bash tool doesn't reap grandchild processes

## Summary

Grepping the whole codebase for `SIGTERM`/`SIGINT`/`process.on` returns nothing — the canonical
dark-factory deployment (a container, per HANDOFF.md §1/§11) will receive SIGTERM on
scale-down/redeploy, and with no handler, Bun's default behavior kills the process abruptly with
no chance to flush a final log line, stop in-flight Bash children, or drain HTTP/SSE connections.
Separately, the Bash tool's timeout/abort path only calls `proc.kill()` on the immediate `bash -c`
process, not its process group — any grandchild the shell command backgrounds (`sleep 300 &`, a
daemon) survives as a zombie/orphan.

## User Stories

### As an operator running `dh` in a container, I want SIGTERM to trigger a clean, logged shutdown

- Given a running session, when the process receives SIGTERM/SIGINT, then it writes a final
  "session interrupted" log line, attempts to stop in-flight agents/tasks, closes the HTTP
  listener, and exits within a bounded grace period.

### As an operator, I want Bash tool timeouts/aborts to not leave orphaned processes behind

- Given a Bash tool call that times out or is aborted, when the tool kills its process, then it
  kills the whole process group (or otherwise reaps descendants), not just the immediate shell.

## Functional Requirements

- Given a SIGTERM during an in-flight JSONL write, when shutdown proceeds, then no log file is left
  in a state worse than "last line possibly truncated" (already a tolerated case per ADR 0005).

## Notes

> [!NOTE]
> Source: Core domain sweep findings #3 and #4; independently confirmed absent by the dark-factory
> ops audit (finding #10, "No PID-1 / signal handling at all" — explicitly grepped and confirmed
> zero hits). Both sweeps flag this as the core gap for HANDOFF's own canonical deployment scenario.
