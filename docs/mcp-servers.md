# MCP server configuration examples

`dh.json`'s `mcpServers` field is a Claude Code-style map of MCP server definitions
(`src/contracts/config.ts`'s `McpServerConfig`), keyed by a name you choose. Both stdio and
HTTP servers are supported in the config schema.

> [!NOTE]
> **Current status: config schema is real, the MCP client isn't wired up yet.** `dh` doesn't
> currently dial into a configured server, list its real tools, or invoke them — `ToolSearch`
> returns a synthetic `mcp__<server>__*` placeholder descriptor per configured entry
> (`src/agent/mcp.ts`), and the `McpAuth` tool is an explicit documented stub that always
> returns "not implemented" (`src/agent/tools/mcp-auth.ts`). The examples below are the
> *config shape* to use once the client lands (and to have ready now, since the shape itself
> is stable) — they don't yet result in a working tool connection. See `tracking/DH-0002` for
> the full-client tracking ticket.

## stdio server (local process)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  }
}
```

`dh` spawns `command args...` as a subprocess and talks MCP over its stdio. Add `env` for a
server that needs its own environment variables (combine with `$(VAR)` interpolation to keep
secrets out of `dh.json` itself — see the [`--env` workflow](../README.md#keeping-secrets-out-of-dhjson---env-file)):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "$(DATABASE_URL)" }
    }
  }
}
```

## HTTP server (remote)

```json
{
  "mcpServers": {
    "internal-tools": {
      "url": "https://mcp.internal.example.com/",
      "headers": { "Authorization": "Bearer $(INTERNAL_MCP_TOKEN)" }
    }
  }
}
```

`url` and `headers` are mutually exclusive with `command`/`args`/`env` per entry — pick the
stdio shape or the HTTP shape for each named server, not both.

## Multiple servers

Any number of entries can coexist under `mcpServers`:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"] },
    "internal-tools": { "url": "https://mcp.internal.example.com/", "headers": { "Authorization": "Bearer $(INTERNAL_MCP_TOKEN)" } }
  }
}
```

Today, `ToolSearch` surfaces one placeholder result per entry (`mcp__filesystem__*`,
`mcp__internal-tools__*`) rather than each server's actual tool list — see the status note
above.

## Auth flows

`McpAuth` is the tool reserved for interactive OAuth-style authorization flows an MCP server
may require at connect time. It's part of the fixed built-in tool set (alongside `Bash`,
`Read`, `Edit`, `Write`, `Agent`, `ToolSearch`, `Skill`, `TaskOutput`, `SendMessage`,
`Monitor`, `TaskStop`) — not something configured per-server in `dh.json` — but calling it
today always returns a "not implemented" error, consistent with the MCP client not being
wired up yet.
