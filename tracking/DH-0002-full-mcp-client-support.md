---
spile: ticket
id: DH-0002
type: feature
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

# DH-0002: Full MCP client support (transport discovery)

## Summary

`dh.json`'s `mcpServers` config and the `ToolSearch` tool exist, but `ToolSearch` returns one
synthetic descriptor per configured server rather than discovering and returning genuinely
callable tools, and doesn't support the real Claude Code query grammar (`select:Name1,Name2`
exact selection, `+term` required-token ranking, `max_results`). This is substantial, not a
quick fix — it needs a real design pass before it's pipeline-ready, hence `draft` status
rather than `ready`.

**Scope note (owner decision, 2026-07-15):** McpAuth/OAuth support split out to **DH-0057**,
deferred further out than this ticket. This ticket (real transport discovery + query grammar)
stays queued as genuine eventually-doing scope, not a "won't do."

## User Stories

### As an agent, I want to discover and invoke real tools exposed by a configured MCP server

- Given an `mcpServers` entry (stdio or HTTP transport) in `dh.json`, when the agent calls
  `ToolSearch`, then it returns real, callable tool descriptors from that server — not a
  single synthetic placeholder.
- Given a `ToolSearch` query using the real convention (`select:Name1,Name2`, `+term`,
  keyword ranking, `max_results`), when the query runs, then results match that grammar, not
  a bare substring match against server name/transport.

## Functional Requirements

- Given any MCP server configured in `dh.json`, when the harness starts, then its tools
  become genuinely reachable through the existing tool-call loop with no special-casing
  elsewhere in the agent loop.

## Assumptions

- Both stdio and HTTP MCP transports need support, per `dh.json`'s existing schema.

## Risks

- Real MCP client code is a meaningful new dependency surface (transport handling, protocol
  version negotiation) — scope and vet carefully before committing to an implementation.

## Open Questions

- Which MCP SDK/library (if any) to depend on, vs. hand-rolling the protocol.
- Exact ownership: likely a new `src/agent/mcp-client.ts`-shaped addition to Core, with
  Prompt's `ToolSearch` description/query-grammar docs moving in lockstep.

## Notes

> [!NOTE]
> Scoped as possibly-deferred from the original HANDOFF.md spec; confirmed still a stub by
> Fable's tool-conformance audit (round 15 of this project's build).
