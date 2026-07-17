# MCP server configuration examples

`dh.json`'s `mcpServers` field is a Claude Code-style map of MCP server definitions
(`src/contracts/config.ts`'s `McpServerConfig`), keyed by a name you choose. Both stdio and
HTTP servers are supported in the config schema.

> [!NOTE]
> **`dh` connects to configured servers for real** (DH-0002): stdio and (Streamable HTTP,
> with legacy HTTP+SSE fallback) transports both work, using the official
> `@modelcontextprotocol/sdk` client. Every server's tools are discovered at startup
> (`tools/list`) and become real, callable tools — no synthetic placeholders. Each server
> connects eagerly and in parallel when the runtime starts; an unreachable server is logged
> and skipped, never blocking the others or the session start (see "Failure handling"
> below). `McpAuth` (OAuth-authenticated MCP servers) remains an explicit stub — that's
> **DH-0057**, split out and still not implemented; unauthenticated servers work today.

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
secrets out of `dh.json` itself — see the [`--env` workflow](../docs/CONFIGURATION.md#keeping-secrets-out-of-dhjson---env-file)):

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

`ToolSearch` surfaces each server's actual discovered tools (`mcp__filesystem__read_file`,
`mcp__internal-tools__whatever_it_exposes`, etc.), not a placeholder per entry — see
"Discovering and calling MCP tools" below.

## Discovering and calling MCP tools

MCP-derived tools are **deferred**: they're discovered and connected at startup, but hidden
from the model's own tool list until `ToolSearch` selects them (this keeps a large server's
full tool surface from bloating every turn's context — the same deferred-tool model real
Claude Code uses). The model activates one with an exact-name `select:` query:

```
ToolSearch({ query: "select:mcp__filesystem__read_file" })
```

which returns that tool's full name, description, and input schema, and makes it callable on
the very next turn. `ToolSearch` also supports keyword search across the combined corpus of
built-in and MCP tools (`+term` requires a token, remaining words rank matches by keyword
score, `max_results` caps ranked output at 5 by default) — see the tool's own description for
the full grammar. Once discovered, a server's tools are named `mcp__<serverName>__<toolName>`
and dispatch exactly like any built-in tool.

### Failure handling

- A server that's unreachable at startup is logged and marked failed; every other server
  still connects normally, and the session starts regardless.
- A `ToolSearch` call gives any currently-failed server one throttled reconnect attempt
  (at most once every 60 seconds per server) — no reconnect storm, but a server that comes
  back up is picked up again without a restart.
- A mid-session tool call that fails or times out (default per-call timeout: 60s) returns a
  normal tool error to the model, exactly like a failing built-in tool — the agent loop
  never crashes because of it. A connection that dies mid-session gets one reconnect
  attempt on its next call before erroring.
- `timeoutMs` (optional, per server) overrides both the connect timeout (default 10s) and
  the per-call timeout (default 60s):

  ```json
  { "mcpServers": { "slow-server": { "url": "https://slow.example.com/", "timeoutMs": 30000 } } }
  ```

## Auth flows

`McpAuth` is the tool reserved for interactive OAuth-style authorization flows an MCP server
may require at connect time. It's part of the fixed built-in tool set (alongside `Bash`,
`Read`, `Edit`, `Write`, `Agent`, `ToolSearch`, `Skill`, `TaskOutput`, `SendMessage`,
`Monitor`, `TaskStop`) — not something configured per-server in `dh.json` — but calling it
today always returns a "not implemented" error. OAuth-authenticated MCP servers are
**DH-0057**, split out from DH-0002 and still not implemented; only unauthenticated servers
(no `McpAuth` flow needed) work today.
