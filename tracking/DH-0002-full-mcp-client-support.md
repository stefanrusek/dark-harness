---
spile: ticket
id: DH-0002
type: feature
status: ready
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

## Design (architect pass — Fable, 2026-07-15)

Grounded against the code as it stands: `src/contracts/config.ts` (`McpServerConfig` already
carries stdio fields `command`/`args`/`env` and HTTP fields `url`/`headers`),
`src/agent/mcp.ts` (the synthetic-descriptor stub this ticket replaces),
`src/agent/tools/tool-search.ts` + `types.ts` + `index.ts` (the `Tool` interface, the fixed
tool map, `ToolContext.searchDeferredTools`), `src/agent/loop.ts` (dispatch is a plain
`params.tools.get(name)` → `tool.execute(input, ctx)`; `toolDefs` is currently computed
**once** before the turn loop), and `src/agent/runtime.ts` (one `toolMap` per
`AgentRuntime`, shared by root and every sub-agent; `buildToolContext` per agent).

OAuth/`McpAuth` is **out of scope** — split to DH-0057; nothing below touches it.

### 1. Dependency: adopt `@modelcontextprotocol/sdk` (client side only)

**Decision: depend on the official SDK; do not hand-roll the protocol.**

The project's dependency-minimalism convention is real but it is "don't add a dependency
for something trivial to hand-roll" (Iris skipped a YAML parser for frontmatter; DH-0056's
Markdown work went zero-dependency), not zero-dep dogma — `package.json` already carries
`@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime` for exactly this class of
"real protocol, real provider, don't reimplement it" surface. MCP is that class:

- **Protocol version negotiation**: the `initialize` handshake with capability exchange and
  a version the spec revises regularly. Hand-rolled code is forever chasing spec revisions;
  the SDK is maintained in lockstep with the spec by the MCP org.
- **stdio transport**: child-process lifecycle, newline-delimited JSON-RPC framing over
  stdin/stdout, stderr passthrough, clean shutdown — every one a known footgun.
- **HTTP transport**: modern Streamable HTTP (session management, optional SSE response
  streams, resumability) *plus* fallback to the legacy HTTP+SSE transport that many
  deployed servers still speak. This is the single strongest argument against hand-rolling:
  two wire dialects for `url`-configured servers, one of them stateful.
- The client surface maps 1:1 onto our existing config: `StdioClientTransport` ⇔
  `command`/`args`/`env`; `StreamableHTTPClientTransport` (with SSE fallback) ⇔
  `url`/`headers`. No config change needed to adopt it.

Constraints on the adoption: **client-entrypoint imports only** (never the SDK's server
half), pinned semver-minor in `package.json`, and it must bundle cleanly through
`bun build --compile` (it is plain TS/JS — verify in CI via the existing e2e gate, which
already exercises the real compiled binary). Transitive deps (zod et al.) are accepted as
the cost of not owning a protocol implementation.

### 2. Code location: `src/agent/mcp/` (Core)

The surface is large enough for a directory. Replace `src/agent/mcp.ts` with:

- `src/agent/mcp/connection.ts` — one server: wraps SDK `Client` + transport selection
  from its `McpServerConfig` (has `command` → stdio; has `url` → Streamable HTTP with SSE
  fallback), connect/close, `listTools()`, `callTool()`, per-call timeout, connection
  state (`connected` / `failed(error)` / `closed`).
- `src/agent/mcp/manager.ts` — `McpManager`: fan-out over `config.mcpServers`, parallel
  connect with bounded timeout, discovered-tool cache, throttled lazy reconnect for failed
  servers, `close()` for shutdown (kills stdio children).
- `src/agent/mcp/tools.ts` — the adapter folding each discovered MCP tool into the
  existing `Tool` interface (see §5). Naming: `mcp__<serverName>__<toolName>` — the
  convention the stub already established and the same shape real Claude Code uses.

The ToolSearch **query grammar** does *not* live here: it is a property of the ToolSearch
tool, not of MCP, and stays in `src/agent/tools/tool-search.ts` as pure, unit-testable
functions operating on descriptors.

### 3. Startup discovery flow: eager, shared, non-fatal

- `AgentRuntime` constructs (or is injected with, for tests) one `McpManager` from
  `config.mcpServers` and starts connection at runtime startup — **eagerly, in parallel
  across servers, with a bounded per-server timeout** (default 10s; see §6 for the config
  knob). Eager keeps `ToolSearch` fast and surfaces misconfiguration in the logs at
  startup instead of mid-session.
- **Shared per process, not per agent**: one connection per configured server per
  `AgentRuntime`, used by root and every sub-agent. This matches the existing shape
  (`runtime.ts` already holds a single `toolMap` shared by all agents); JSON-RPC request
  ids make concurrent calls over one connection safe, and per-agent stdio children would
  multiply subprocess cost by fan-out for no benefit.
- Discovery result: `tools/list` per connected server, cached in the manager. Discovered
  tools are folded into the runtime's `toolMap` (as deferred `Tool`s, §5) once connected.
  If the SDK surfaces `notifications/tools/list_changed`, refresh that server's cache;
  this is a nice-to-have, not a gate.
- Startup **never fails** because an MCP server is unreachable (§6).

### 4. `ToolSearch` real implementation (query grammar)

Corpus: the merged descriptor set — every built-in tool (always active) plus every
discovered MCP tool from every connected server. Descriptor shape (extending the stub's
`DeferredToolDescriptor`): `{ name, description, inputSchema, deferred, serverName? }` —
MCP descriptors carry the server's declared `inputSchema` verbatim.

Grammar, matching real Claude Code:

- **`select:Name1,Name2`** — exact-name selection, comma-separated. Returns exactly those
  descriptors (full schema included); names not found are reported explicitly. Selecting
  an MCP tool **activates** it (§5); selecting a built-in reports it as already loaded.
- **`+term`** — required token: a descriptor matches only if `term` appears
  (case-insensitive) in its name or description; remaining query terms rank the survivors.
- **Keyword ranking** — tokenize the query; score each descriptor by term hits against
  name (weighted higher) and description; order by score, tiebreak by name.
- **`max_results`** — new optional input (integer, default 5), applied after ranking;
  `select:` ignores it (exact selection returns what was selected). `ToolSearch`'s
  `inputSchema` gains this property.
- Output: for each result, name + description + JSON `inputSchema` (so the model can call
  it next turn); MCP results are activated as a side effect. A footer lists any configured
  servers currently unreachable, with their last error — no silent truncation of the
  corpus.

`ToolSearch.execute` is already async; `ToolContext.searchDeferredTools` becomes
async-returning and descriptor-rich (it's an internal interface in `src/agent/tools/types.ts`,
explicitly not wire truth, so this is Core-local churn).

### 5. Dispatch integration: MCP tools *are* `Tool`s

Each discovered MCP tool is adapted to the existing `Tool` interface:
`name` = `mcp__<server>__<tool>`, `description`/`inputSchema` from discovery, and
`execute(input, ctx)` = `manager.callTool(server, tool, input)` mapping the MCP result to
`ToolResult` (text content concatenated; non-text blocks JSON-encoded with a type note;
MCP `isError` → `ToolResult.isError`). These are merged into the same `toolMap` the
runtime already passes to `runAgentLoop`, so **`runToolCalls` in `loop.ts` needs zero
changes** — `params.tools.get(name)` finds MCP tools exactly like built-ins, and the
existing `tool_call`/`tool_result` JSONL lines and SSE events cover them with no schema
change (ADR 0004 untouched).

The one loop change (MCP-agnostic): `Tool` gains optional `deferred?: boolean`, and
`ToolContext` gains a per-agent `activatedTools: Set<string>` (same per-agent scoping
precedent as `readRegistry`). `loop.ts` moves the `toolDefs` computation inside the turn
loop and filters `t.deferred && !ctx.activatedTools.has(t.name)` — deferred tools are
invisible to the provider until `ToolSearch` activates them (mirroring Claude Code's
deferred-tool model and protecting the context window from large servers), but dispatch
itself never special-cases them. Built-ins never set `deferred`, so standalone behavior
without `mcpServers` is bit-for-bit unchanged.

### 6. Failure handling: degrade, never abort

- **Unreachable at startup**: log the error (stderr + the runtime's log sink), mark the
  server `failed`, continue with every other server's tools. Per ADR 0005, exit codes 2+
  are *harness* errors; a misconfigured or down MCP server is not one.
- **Lazy retry**: a `failed` server gets one reconnect attempt when a `ToolSearch` call
  touches the corpus, throttled to at most once per 60s per server — cheap recovery
  without a reconnect storm.
- **Tool call fails / times out mid-session**: returns `ToolResult { isError: true }` with
  the error and server name — identical to any built-in tool failing; the agent loop
  continues. Per-call timeout default 60s, cancelling the in-flight JSON-RPC request.
- **Connection dies mid-session** (stdio child exits, HTTP session drops): mark `failed`;
  the next call to one of that server's tools attempts one reconnect, then errors as
  above. Already-activated tool names stay in the map so the error is informative rather
  than "Unknown tool".
- **Shutdown**: `McpManager.close()` on runtime teardown terminates stdio children (ties
  into DH-0011's process-reaping concerns; coordinate, don't duplicate).
- **Config knob** (contracts change, sanctioned by this pass per Constitution §6.2, within
  ADR 0006's "extend minimally"): `McpServerConfig` gains one optional field,
  `timeoutMs?: number`, applied to both connect and per-call timeouts for that server.
  Nothing else in `src/contracts/` changes.

### 7. Domain assignment

- **Core (Grace)** owns the whole implementation: `src/agent/mcp/`, the `tool-search.ts`
  rewrite, `types.ts` (`deferred`, `activatedTools`, async `searchDeferredTools`),
  `loop.ts` per-turn `toolDefs`, `runtime.ts` wiring, the one-field
  `src/contracts/config.ts` extension (architect-sanctioned above), and the
  `package.json` dependency addition.
- **Prompt (Iris)** moves in lockstep, same round: the built-in system prompt's
  deferred-tool/`ToolSearch` guidance and README docs must document the real grammar
  (`select:`, `+term`, `max_results`) and the activation model. The `Tool.description`
  string itself lives in Core's file; Iris reviews its wording as a cross-boundary
  request, not a direct edit.
- **E2E (Hedy)**: a mock MCP server fixture, parallel to the existing mock provider — a
  tiny Bun-script stdio server (spawned via `command`) exposing 2–3 known tools, plus an
  HTTP-transport variant. Scenarios: discovery + `select:` + keyword query + real call
  round-trip through the compiled binary; graceful degradation with one good and one
  unreachable server configured.

## Risks

- ~~Which client code to depend on~~ **Decided** (§1): `@modelcontextprotocol/sdk`,
  client-entrypoint only, pinned. Residual risks and their mitigations:
  - SDK bundling under `bun build --compile` misbehaving — verified by the existing e2e
    gate, which runs the real compiled binary; treat any failure there as a blocker before
    building further on the SDK.
  - Transitive dependency growth — accepted deliberately (see §1's reasoning); revisit
    only if the compiled-binary size or install surface becomes a real problem.
- Deferred-tool visibility change (`toolDefs` per-turn) touches every agent loop run —
  mitigated by `deferred` defaulting to absent on all built-ins, making the
  no-`mcpServers` path behaviorally identical; 100% coverage gate applies.
- Stdio child processes add a new kind of process lifecycle to the harness — shutdown path
  must coordinate with DH-0011 (signal handling / process-group reaping) rather than
  invent a parallel mechanism.

## Open Questions

None blocking — resolved by the design pass above. Deliberately deferred (tracked, not
forgotten):

- `notifications/tools/list_changed` live refresh: nice-to-have, not a gate (§3).
- OAuth-authenticated MCP servers: **DH-0057**, explicitly out of scope here.

## Notes

> [!NOTE]
> Scoped as possibly-deferred from the original HANDOFF.md spec; confirmed still a stub by
> Fable's tool-conformance audit (round 15 of this project's build).
