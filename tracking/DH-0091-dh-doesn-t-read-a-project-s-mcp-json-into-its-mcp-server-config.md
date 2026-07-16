---
spile: ticket
id: DH-0091
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0055]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0091: dh doesn't read a project's .mcp.json into its MCP server config

## Summary

Real Claude Code automatically reads a project's .mcp.json (if present in the working directory) and adds those MCP server definitions to its available set, the same way it auto-reads CLAUDE.md into the system prompt (DH-0055). dh currently only knows about MCP servers explicitly listed in dh.json's mcpServers field -- a .mcp.json sitting in the project root is invisible. This should just work automatically like CLAUDE.md support is meant to, mirroring real Claude Code's behavior. Note: DH-0055 itself (CLAUDE.md auto-injection) is still unimplemented as of this ticket's filing (status ready, no code yet) -- this is a sibling gap, not dependent on DH-0055 landing first, but the two should probably be implemented with a consistent project-root-file-discovery convention.

## User Stories

### As an operator running `dh` in a project that already has a `.mcp.json`, I want its MCP servers available without duplicating them into `dh.json`

- Given a `.mcp.json` file exists in the working directory, when `dh` builds its MCP server
  set (per DH-0002's real client), then those servers are merged in alongside whatever
  `dh.json`'s own `mcpServers` field defines — without the operator having to hand-copy
  the definitions.
- Given no `.mcp.json` exists, when `dh` starts, then behavior is unchanged from today (no
  error, no missing-file warning spam) — same "silent no-op when absent" convention as
  DH-0055.
- Given the same server name appears in both `.mcp.json` and `dh.json`'s `mcpServers`, when
  merging, then a well-defined precedence applies (implementer's call — likely `dh.json`
  wins, since it's the operator's own explicit harness config, mirroring how
  `config.systemPrompt` would take precedence in DH-0055's design if that question arises
  there too).

## Functional Requirements

- Real Claude Code's `.mcp.json` schema (top-level `mcpServers` key, same shape as dh's own
  `dh.json.mcpServers` field per `McpServerConfig`) — read it directly and reuse the
  existing parsing/validation path rather than inventing a second schema.
- Wire into `src/config/` (wherever `dh.json` loading/merging happens) or `src/agent/mcp/`
  (wherever `McpManager` is constructed from config) — implementer's call on the cleanest
  integration point, but the file read should happen once at startup, consistent with how
  DH-0002's `McpManager` already connects eagerly at startup.

## Assumptions

- Discovery is single-file, working-directory-root only for v1 (no nested/parent-directory
  search) — same scoping simplification DH-0055 already assumes for CLAUDE.md.

## Notes

> [!NOTE]
> Filed 2026-07-16, prompted directly by the owner noting this should "just work" the same
> way CLAUDE.md support is meant to (DH-0055). Sibling gap, not blocked on DH-0055 landing
> first, but the two should share a consistent project-root-file-discovery convention if
> implemented separately.
