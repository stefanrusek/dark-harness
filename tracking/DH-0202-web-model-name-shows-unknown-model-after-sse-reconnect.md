---
spile: ticket
id: DH-0202
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: ["DH-0024", "DH-0093"]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0202: Web model name shows "(unknown model)" after SSE reconnect

## Summary

After an SSE reconnect (`Last-Event-ID` resume, e.g. triggered by a page reload or network
blip), the transcript replays correctly but the active model name shows "(unknown model)"
instead of the real model. A given agent's model name is only ever sent once, on its
original `agent_spawned` event; if a reconnect's replay resumes from a point after that
event (or otherwise never redelivers it), any state-side node for that agent created from a
later event (e.g. `agent_output`) via `ensureAgent` gets `model: ""` and nothing ever fixes
it up.

## User Stories

### As an operator whose connection reconnects mid-session, I want the active model name to stay correct

- Given an agent's `agent_spawned` event was never (re)delivered to this client — only later
  events for that agent id arrived, so its node was created with an empty model — when the
  agent tree bootstrap (re-run on every SSE reconnect) reports a model for that agent, then
  the client fills in the missing model without disturbing the agent's other live fields
  (status, transcript).
  - Proven by: `src/web/client/state.test.ts` — "DH-0202: patches in a missing model on an
    already-known agent without clobbering its live fields".
- Given an agent's model is already known from an earlier `agent_spawned` event, when a later
  tree bootstrap response reports a different (stale) model for it, then the already-known
  model is left untouched.
  - Proven by: `src/web/client/state.test.ts` — "does not overwrite an already-known model
    even if the tree response disagrees".
- Given the SSE connection reconnects after a drop, when the reconnect completes, then the
  client re-fetches the agent tree (in addition to showing the existing DH-0024 gap banner),
  and any agent whose model had gone unknown across the reconnect is corrected.
  - Proven by: `src/web/client/app.test.ts` — "DH-0202: a reconnect re-fetches the agent tree
    and fills in a model name lost across it".

## Functional Requirements

- `seedFromTree` (state.ts) patches a missing (`""`) `model` field onto an already-known
  agent from the tree response, without touching any other field on that agent.
- `AppView.handleReconnected` (app.ts) re-runs the same tree bootstrap used on initial
  connect, so a reconnect gets a fresh chance to learn every agent's real model.

## Assumptions

- The `request_agent_tree` response's `model` field is always authoritative/current for a
  given agent — safe to trust for backfilling a blank model even after other events have
  already updated other parts of that agent's state.

## Risks

- Minor extra network traffic: one additional `request_agent_tree` call per reconnect. Same
  cost class as the existing `list_skills`/`request_agent_tree` bootstrap already made on
  initial connect; not expected to be meaningful given reconnects are already backed off
  (DH-0024).

## Open Questions

- None blocking. Whether the *server's* Last-Event-ID replay ought to also resend
  `agent_spawned` for agents whose model wasn't otherwise seen is a Server-domain question,
  out of scope for this Web-only ticket — the client-side fix here is correct regardless of
  what the server does.

## Notes

- 2026-07-19: Root cause: `ensureAgent` (state.ts) creates a new `AgentNode` with `model: ""`
  whenever an event other than `agent_spawned` arrives for an agent id state hasn't seen
  before; `seedFromTree`'s merge logic previously skipped any agent id already present in
  `state.agents` entirely ("SSE already told us something more current"), so a blank model
  from that path was never corrected. Fixed in two places: (1) `seedFromTree` now patches in
  `model` on an already-known agent when its current value is falsy and the tree response has
  one, leaving every other field alone (`src/web/client/state.ts`); (2)
  `AppView.handleReconnected` (`src/web/client/app.ts`) now calls the same
  `bootstrapAgentTree()` used on initial connect, so a reconnect gets a fresh
  `request_agent_tree` round-trip to source a corrected model from. Verified via `bun run
  typecheck`, `bun run lint`, `bun run test:coverage` (2180 pass, 100.00% lines on all
  changed files), and `bun run e2e` (38 pass).
