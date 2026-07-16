---
spile: ticket
id: DH-0057
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

# DH-0057: MCP OAuth support via McpAuth tool

## Summary

McpAuth is an honest, documented stub with no OAuth flow. Split out of DH-0002 (owner decision 2026-07-15): DH-0002's transport/discovery work stays queued as real, eventually-doing scope; this OAuth piece is deferred further out — no configured MCP server needing auth exists yet, revisit once one does.

## User Stories

### As an operator with an authenticated MCP server, I want to complete its OAuth flow through `McpAuth`

- Given an `mcpServers` entry requiring OAuth, when the agent calls `McpAuth`, then it
  actually drives the OAuth flow rather than returning a stub error.

## Notes

> [!NOTE]
> Split from DH-0002 (owner decision, 2026-07-15). Deferred further out than DH-0002's
> remaining scope — no operator has configured an OAuth-requiring MCP server yet, so there's
> no concrete auth flow to design against. Revisit once a real integration needs it.

> [!NOTE]
> Public GitHub issue created (2026-07-16) to gauge real demand before building this: https://github.com/stefanrusek/dark-harness/issues/6
