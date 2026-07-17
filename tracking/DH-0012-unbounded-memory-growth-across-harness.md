---
spile: ticket
id: DH-0012
type: bug
status: verifying
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

- **Owner decision (2026-07-15): fixed-count cap, not TTL/read-tracking.** Each of the four
  structures (`TaskRegistry`'s task map + `readCursors`, `EventBuffer`, TUI's `agents` map,
  Web's `agents` map) caps at the **50 most-recent terminal/completed entries**, evicting the
  oldest beyond that count — same simple shape `EventBuffer` already uses for its 1000-event
  cap, just applied consistently everywhere and at a smaller default since these are
  per-agent/per-task entries, not fine-grained events. Active (non-terminal) entries are never
  evicted regardless of count.
- A single `dh.json` config knob controls the default (e.g. `limits.completedRetention: 50`),
  so it can be changed without a code change per the owner's explicit "we can change it later
  if needed" framing.
- `EventBuffer` additionally needs a byte-bound (not just count), since a single large
  `agent_output.chunk` can dominate memory regardless of entry count — implementer's call on
  a reasonable default byte cap (e.g. 10MB), evicting oldest entries first when exceeded, same
  as the count-based eviction.

## Notes

> [!NOTE]
> 2026-07-17: All four scoped fixes verified present — Core (`TaskRegistry`'s
> `completedRetention` cap on tasks + `readCursors`, wired from `dh.json`'s
> `limits.completedRetention` via `AgentRuntime`/`config/validate.ts`, commit `3d182f4`),
> Server (`EventBuffer` byte-bound, `src/server/event-buffer.ts`/`server.ts`), TUI (`agents`
> map cap, `src/tui/state.ts`), and Web (`agents` map cap, `src/web/client/state.ts`) all
> carry `DH-0012` references and matching tests. Ran this session: `bun run typecheck` clean,
> `bun test src` 2040/2040 passing, `bun run lint` clean for all `src/agent` files (the only
> lint failures are pre-existing, unrelated formatting issues in `.claude/skills/` scripts).
> Moving to `verifying`.

> [!NOTE]
> Source: Core sweep findings #5 and #6 (TaskRegistry + readCursors); Server sweep finding #1
> (EventBuffer unbounded bytes); TUI/Web sweep findings #21 and #22 (unbounded `agents` maps in
> both clients, no per-agent cap at all in Web). Four independently-discovered instances of the
> same underlying pattern — worth fixing as one theme even though the fixes land in different
> domains (Core, Server, TUI, Web).

> [!NOTE]
> DH-0044 (2026-07-16, Radia): once always-on streaming lands, `EventBuffer`'s **1000-event
> count cap becomes the binding constraint far sooner in wall-clock terms** — a single
> assistant turn now coalesces into many `agent_output` events (~1 per 1 KiB/50ms flush,
> roughly 50-1000 events for a large turn) instead of one, while total buffered *bytes* stay
> roughly flat (same text, ~150B/event envelope overhead). Whoever implements this ticket's
> byte-bound for `EventBuffer` should size the event-count cap with this in mind (e.g. bump it
> to ~5000) or lean on the byte cap (already noted above, ~10MB) as the primary bound rather
> than the count cap. Not implemented here — DH-0044 is Core+Server's streaming ticket, this is
> just a sizing flag for this ticket's own implementer.
