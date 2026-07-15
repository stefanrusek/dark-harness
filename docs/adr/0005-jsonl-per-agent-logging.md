# ADR 0005: JSONL-per-agent session logging

**Status:** Accepted

## Context

Diagnostics and dark-factory optimization depend on being able to reconstruct exactly what
every agent (root and sub-agents, arbitrary nesting depth) did in a session, after the fact
and potentially while other agents are still running concurrently.

## Decision

- Every session creates a **log directory**.
- **One JSONL file per agent.**
- The **first line of each file is a metadata header**: at minimum session id, agent id,
  parent agent id (`null` for root), spawn timestamp, model name, and an instructions/prompt
  summary or hash. A tool reading only first lines across all files in a session directory
  can reconstruct the full timeline and agent tree without parsing event bodies.
- Subsequent lines are timestamped events: messages, tool calls and results, token usage,
  status changes, completion/failure — sufficient to replay an agent's full activity from
  its file alone.
- Logging is **automatic**: agent actions and output flow to these logs as a side effect of
  the harness; agents never call a logging tool themselves.

## Consequences

- The header schema is part of `src/contracts/` — any field addition/removal is a
  contracts-domain change (CLAUDE.md §6 escalation trigger 2), because external tooling
  (dashboards, dark-factory analysis scripts) will parse first-lines-only.
- Log writing must be robust to a session ending mid-write (crash, kill) — readers should
  tolerate a truncated final line.
- Token redaction (ADR 0004) applies at the log-writing layer, not as a separate scrub pass.
