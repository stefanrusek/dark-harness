---
spile: ticket
id: DH-0012
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

# DH-0012: Unbounded in-memory growth across the harness for long/wide-fanout runs

## Summary

Multiple independent structures grow without eviction for the life of a process, which matters
specifically for the "hours-long, many-sub-agent" dark-factory use case: `TaskRegistry`
(`src/agent/tasks.ts`) never evicts finished tasks (or their captured stdout/stderr `chunks`) from
its `Map`, nor its per-reader `readCursors` map; the server's `EventBuffer` is bounded by event
*count* (1000) but not by serialized *bytes*, so large `agent_output.chunk` values make it an
unbounded-byte buffer in practice; the TUI's `agents: Map` and the Web client's `state.agents: Map`
are never pruned of completed agents (only per-agent transcript text is capped, and only in the
TUI); the Web client has no per-agent transcript cap at all, backed by ever-growing DOM nodes.

## User Stories

### As an operator running a long session with heavy sub-agent churn, I want the harness's memory footprint to reflect currently-relevant agents, not every agent ever spawned

- Given a session that has spawned thousands of short-lived sub-agents, when it has been running
  for hours, then server/TUI/web memory use scales with active + recently-relevant agents, not the
  full historical count.

### As an operator, I want a long-running SSE/event stream to not accumulate unbounded memory from large tool output

- Given an agent that emits very large `agent_output` chunks (e.g. a big file Read), when many such
  events accumulate in the server's event buffer, then total buffered bytes are bounded, not just
  event count.

## Functional Requirements

- Given any of the above structures, when an entry becomes terminal/irrelevant and has been read at
  least once (or exceeds a TTL), then it is eligible for eviction, with a config knob for the
  bound.

## Notes

> [!NOTE]
> Source: Core sweep findings #5 and #6 (TaskRegistry + readCursors); Server sweep finding #1
> (EventBuffer unbounded bytes); TUI/Web sweep findings #21 and #22 (unbounded `agents` maps in
> both clients, no per-agent cap at all in Web). Four independently-discovered instances of the
> same underlying pattern — worth fixing as one theme even though the fixes land in different
> domains (Core, Server, TUI, Web).
