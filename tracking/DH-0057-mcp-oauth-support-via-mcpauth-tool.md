---
spile: ticket
id: DH-0057
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

# DH-0057: MCP OAuth support via McpAuth tool

## Summary

Turn `McpAuth` from an honest "not implemented" stub into a real, mock-testable OAuth 2.1
flow for URL-transport MCP servers, driven end-to-end through the tool. Split out of DH-0002
(owner decision 2026-07-15) and previously deferred for lack of a live OAuth-requiring MCP
server; owner asked it to move forward regardless (2026-07-19). Because no specific vendor
exists to target, the design is built against the **MCP spec's generic OAuth 2.1 conventions**
(RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata, RFC 7591
dynamic client registration, authorization_code + PKCE, RFC 8252 loopback redirect) — all of
which the bundled `@modelcontextprotocol/sdk` already implements client-side. `dh` supplies
the glue: an `OAuthClientProvider` backed by on-disk token storage, a transient loopback
redirect receiver, and a two-phase tool contract that fits `dh`'s no-approval-prompt posture.

## Ownership

**Core** (Grace) owns the whole feature: `src/agent/mcp/` (new `oauth-provider.ts`,
`oauth-loopback.ts`, `token-store.ts`; edits to `connection.ts`, `manager.ts`),
`src/agent/tools/mcp-auth.ts`, and the `ToolContext` wiring in `src/agent/runtime.ts`.

The one shared-schema edit is `src/contracts/config.type.ts` (the `auth` block on
`McpServerConfig`, below). Per CLAUDE.md §6 trigger 2 that is architect-reviewed; **it is
approved in this ticket by the architect-on-call (Fable)** — the shape is a minimal additive
extension of the existing `dh.json` schema (ADR 0007), not a restructure, so no separate ADR
is required. Update `docs/adr/0007-dhjson-schema.md`'s field inventory only if it enumerates
`McpServerConfig` fields explicitly.

## Design

### Architecture: lean on the SDK, glue in Core

The SDK's `client/auth.js` exports the full OAuth toolkit (`OAuthClientProvider` interface,
the `auth()` orchestrator, `discoverOAuthProtectedResourceMetadata`, `registerClient`,
`startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`), and both URL transports
(`StreamableHTTPClientTransport`, `SSEClientTransport`) accept an `authProvider` option. When
one is set the transport:
1. attaches any existing access token on connect,
2. auto-refreshes via the refresh token when the access token is expired (calling the
   provider's `saveTokens`),
3. throws `UnauthorizedError` when interactive authorization is required,
4. exposes `finishAuth(authorizationCode)` to exchange a code for tokens and persist them.

So `dh` never hand-rolls PKCE, discovery, or token exchange. It implements exactly three
things: (a) an `OAuthClientProvider` whose persistence is a file under `~/.dh/`, (b) a
loopback HTTP receiver to catch the authorization redirect, and (c) the `McpAuth` tool that
sequences them.

### 1. Flow shape and the loopback receiver

**Grant types.** Two, selected by config:
- **`authorization_code` + PKCE (default, interactive).** The MCP-spec-standard flow. Needs a
  redirect/callback URI, hence a loopback listener (below). Two-phase tool contract (§3).
- **`client_credentials` (non-interactive, machine-to-machine).** For air-gapped / dark-factory
  deployments where a static client id+secret is provisioned and no human/browser exists.
  `redirectUrl` returns `undefined` (SDK-supported for non-interactive grants); no loopback,
  no URL to visit — the whole grant runs inline in one `McpAuth` call.

**The loopback receiver** (`src/agent/mcp/oauth-loopback.ts`):

```ts
export interface LoopbackReceiver {
  /** e.g. "http://127.0.0.1:49812/callback" — the OAuth redirect_uri. */
  readonly redirectUri: string;
  /** Resolves when the browser redirect lands; rejects on timeout or a `?error=` redirect. */
  waitForCode(timeoutMs: number): Promise<{ code: string; state: string }>;
  /** Idempotent teardown of the transient server. */
  close(): Promise<void>;
}

export function startLoopbackReceiver(opts?: { port?: number }): LoopbackReceiver;
```

It binds `Bun.serve` on **`127.0.0.1` only** (loopback, never `0.0.0.0`), ephemeral port by
default (`opts.port ?? 0`, overridable via `auth.redirectPort`), serving exactly one route
`/callback`. On the redirect it captures `code`+`state` (or `error`), returns a minimal
"authorization complete — you can close this tab" HTML page, and resolves `waitForCode`.

**Interaction with the single-binary architecture (CLAUDE.md §4.1 / ADR 0001).** This is
**not** a `dh` run mode and is **not** the `--server` HTTP+SSE server. It is a transient,
loopback-only, one-shot receiver that lives only for the duration of an `McpAuth` interactive
flow and is torn down immediately after — architecturally the same class of thing as the Bash
tool spawning a child process: an internal transient of a tool call, not a composed process
mode. It therefore introduces **no new externally-reachable network surface** and is
consistent with the security posture (ADR 0004): loopback bind only, no listening on the
configured `--server`/web hostname, nothing added to the client↔server protocol.

### 2. Token storage, scoping, refresh

**Location.** A new per-user state dir: `~/.dh/mcp-auth/<sanitized-server>.json`
(`sanitized-server` = the `mcpServers` key with non-`[A-Za-z0-9_.-]` replaced by `_`). Dir
created `0700`, files written `0600`. Root resolved as
`process.env.DH_HOME ?? path.join(os.homedir(), ".dh")` — the `DH_HOME` override exists
primarily for hermetic test isolation (point it at a tmp dir), and secondarily for operators
who relocate state. **`~/.dh/` is new to the project** (grep confirms no prior use); this
ticket establishes it as `dh`'s user-state directory. It is distinct from `dh.json` (which is
CWD- or `--config`-located project config) — tokens are per-user secrets, not project config,
so they do not belong in `dh.json` and must never be written back into it.

**Scoping.** One file per `mcpServers` key. Files are independent; authenticating or revoking
one server never touches another.

**File format** (`token-store.ts`, `interface StoredMcpAuth`, `version: 1`):

```jsonc
{
  "version": 1,
  "serverName": "acme",
  "serverUrl": "https://mcp.acme.example/v1",
  "clientInformation": {            // from RFC 7591 DCR, or static from config
    "client_id": "...",
    "client_secret": "...",         // absent for public clients
    "client_id_issued_at": 0
  },
  "tokens": {                       // the SDK's OAuthTokens shape
    "access_token": "...",
    "token_type": "Bearer",
    "refresh_token": "...",
    "expires_in": 3600,
    "obtained_at": 1721385600000,   // dh-added: epoch ms, for expiry math
    "scope": "mcp:tools"
  },
  "codeVerifier": "...",            // transient: present only between begin and complete
  "resourceMetadataUrl": "https://mcp.acme.example/.well-known/oauth-protected-resource",
  "updatedAt": 1721385600000
}
```

Secrets (`client_secret`, tokens, code verifier) are **never logged** — same rule as
`security.token` (ADR 0004). The JSONL log/SSE for an `McpAuth` call records the action,
server, and outcome only; the file contents never appear in a log line or error string.

**Refresh story.** Fully automatic and transparent once tokens exist. Because
`McpConnection` builds its transport **with** the `authProvider` whenever `config.auth` is set,
every ordinary `connect()` (startup `connectAll`, ToolSearch's lazy reconnect, mid-session
`callTool` reconnect) lets the SDK auto-refresh an expired access token via the stored refresh
token and call our `saveTokens`, which rewrites the file. `McpAuth` only needs re-invoking
when the **refresh token itself** is missing/expired/revoked — in which case the transport
surfaces `UnauthorizedError`, the connection stays `failed` with an actionable
`lastError` (the existing ToolSearch unreachable-servers footer already surfaces this), and the
agent re-runs `McpAuth begin`.

### 3. The `OAuthClientProvider` implementation

`src/agent/mcp/oauth-provider.ts`:

```ts
export class DhOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly authConfig: McpServerAuthConfig,
    private readonly store: McpTokenStore,   // wraps ~/.dh/mcp-auth/<server>.json
  ) {}

  get redirectUrl(): string | undefined;     // loopback redirectUri for auth_code; undefined for client_credentials
  get clientMetadata(): OAuthClientMetadata;  // { client_name: "dh", redirect_uris, grant_types, scope, token_endpoint_auth_method }
  state(): string;                            // random CSRF state, persisted for verification

  clientInformation(): OAuthClientInformationMixed | undefined;  // static (config) or DCR-saved
  saveClientInformation(info): void;          // persists DCR result to the store

  tokens(): OAuthTokens | undefined;          // from the store
  saveTokens(tokens): void;                   // persists (refresh + initial), stamps obtained_at

  saveCodeVerifier(v): void;                  // PKCE verifier -> store (transient)
  codeVerifier(): string;                     // read it back for the exchange

  // dh-specific: DOES NOT open a browser. Stashes the URL so the tool returns it to the agent,
  // which relays it to the operator. This is the crux of fitting dh's no-approval-prompt model.
  redirectToAuthorization(url: URL): void;    // sets this.pendingAuthorizationUrl
  readonly pendingAuthorizationUrl?: URL;
}
```

The key deviation from a browser app: `redirectToAuthorization` **does not launch a browser**.
It records the URL. The `McpAuth` tool reads `pendingAuthorizationUrl` and returns it in the
tool output for the operator to open manually. That is what makes an out-of-band human step
possible in a harness that (§4.7) has no built-in approval/human-in-the-loop moment.

### 4. Tool contract — two-phase, plus status

`McpAuth` input schema:

```jsonc
{
  "server":  { "type": "string" },                                   // required: the mcpServers key
  "action":  { "enum": ["status", "begin", "complete"] },            // optional; see default below
  "timeoutMs": { "type": "integer" }                                 // optional, "complete" only; default 300000, capped 900000
}
```

Default `action` when omitted: `status` if no flow is in progress, else `complete` (so a bare
`McpAuth({server})` after a `begin` naturally continues it).

- **`status`** — reports one of: `not-configured` (server has no `auth` block),
  `authenticated` (valid tokens; includes expiry), `pending` (a `begin` is awaiting its
  callback; re-echoes the URL), `needs-auth` (configured but no/expired-unrefreshable tokens).
  `isError: false` in all cases — it is informational.

- **`begin`** — **non-blocking.** For `authorization_code`: run SDK discovery
  (protected-resource → authorization-server metadata), dynamic-register if no static
  `clientId`, generate PKCE + state, start the loopback receiver, register it on the
  `McpManager` keyed by server, and return the `authorizationUrl` + `redirectUri` + how to
  finish. Returns **immediately** so the agent can relay the URL to the operator. For
  `client_credentials`: perform the entire grant inline (no URL, no loopback) and return
  success in this single call.

  Example `begin` output (authorization_code):
  ```
  To authorize MCP server "acme", open this URL in a browser and approve access:
    https://auth.acme.example/authorize?response_type=code&client_id=...&code_challenge=...&state=...
  Then call McpAuth with { "server": "acme", "action": "complete" } to finish.
  This authorization link expires in 5 minutes.
  ```

- **`complete`** — **blocks up to `timeoutMs`** on the loopback receiver's `waitForCode`. On
  receipt: verify `state` (CSRF), call `transport.finishAuth(code)` (SDK exchanges the code +
  PKCE verifier for tokens and persists via our provider), close the receiver, and
  `McpManager.reconnect(server)` so the now-authenticated tools become discoverable. Returns
  success with the token expiry. If the code was already captured before `complete` was
  called, returns immediately. If the timeout elapses with no callback, returns
  `isError: false` with "still waiting — the authorization URL has not been visited yet; open
  it and call complete again" (an actionable pending state, **not** a harness failure).

**Why two-phase and not one blocking call.** A tool's output only reaches the operator after
`execute()` resolves. A single blocking call could not surface the authorization URL until it
had already returned — too late for the operator to act. `begin` hands the URL back
immediately; `complete` does the waiting. This keeps the human step out-of-band and
opt-in-by-the-agent, consistent with §4.7's "no approval prompts, everything allowed" — `dh`
never *imposes* a pause; the agent chooses to call `McpAuth` and to wait on `complete`.

### 5. Connection + manager + context wiring

- `connection.ts` `buildTransport`: when `config.auth` is present and the server is
  URL-transport, construct the transport with `{ authProvider: new DhOAuthProvider(...) }`
  (reuse one provider instance per connection so refresh persistence is coherent). A `command`
  (stdio) server with an `auth` block is a **config validation error** (OAuth is meaningless
  over stdio) — reject at config load with a clear message.
- `manager.ts`: hold a `Map<serverName, LoopbackReceiver>` for in-flight interactive flows
  (started by `begin`, consumed by `complete`), plus a `reconnect(serverName)` helper (thin
  wrapper over the existing `connectAndCache`) the tool calls after a successful exchange.
- `runtime.ts` `buildToolContext`: expose the `McpManager` (or a narrow
  `mcpAuth: { begin, complete, status }` façade over it) on `ToolContext` so `mcp-auth.ts` can
  reach the manager without importing the runtime (same injection precedent as
  `searchDeferredTools`). This is an internal `ToolContext` extension, not a wire contract.

### 6. Testability (100% coverage against mocks — CLAUDE.md §5/§9)

All of the core flow is unit/component-testable under `bun test src` with **no real external
provider**, because the SDK speaks plain HTTP to endpoints the test hosts. Build a
**mock OAuth+MCP endpoint** (a `Bun.serve` fixture, sibling to the existing mock
Anthropic-compatible provider) implementing:
`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
`/register` (DCR), `/authorize` (immediately 302-redirects to the supplied `redirect_uri` with
a canned `code` and echoed `state` — simulating instant operator approval), and `/token`
(issues access+refresh; supports `authorization_code`, `refresh_token`, and
`client_credentials` grants), plus an MCP `tools/list`/`tools/call` surface gated on a valid
bearer.

Test isolation uses `DH_HOME` pointed at a tmp dir. The loopback receiver binds a real
ephemeral `127.0.0.1` port in-test (fine — deterministic, no external network). Coverage set:
- `begin` returns the authorization URL + loopback redirectUri; receiver started.
- operator simulation: GET the returned `authorizationUrl` against the mock → it 302s to the
  loopback redirectUri → receiver captures the code → `complete` exchanges, persists tokens,
  reconnects, and the server's tools become callable.
- `client_credentials` single-call grant (no URL, no loopback).
- automatic refresh: seed an expired access token + valid refresh token, connect, assert the
  SDK refreshed and `saveTokens` rewrote the file.
- `status` for each of not-configured / needs-auth / pending / authenticated.
- error/edge paths: `state` (CSRF) mismatch; `/token` error response; `complete` timeout with
  no callback (actionable pending, not failure); stdio server with `auth` set (config error);
  unknown server; corrupt/absent token file; file mode `0600` + dir `0700`; per-server
  isolation; secrets never appear in logged/returned strings.

### 7. What genuinely cannot be built/tested without a real provider (integration tier, §9)

Everything above lands and gates on mocks. The one slice that structurally cannot be verified
against a mock — and per CLAUDE.md §9 belongs in the **integration tier, not the coverage
gate, and is not a blocker on landing the core flow** — is live-provider conformance against a
real OAuth-requiring MCP server: real DCR acceptance and returned metadata quirks, a real
authorization-server's discovery-document shape, a real consent-screen redirect, and real
token TTL/refresh/revocation semantics. This is exactly the class §9 carves out (only
verifiable against real behavior, haiku-class-cost cap N/A here since it's an OAuth server not
a model). It **cannot be built now** — the original defer reason stands: no real
OAuth-requiring MCP server is configured to test against (see GitHub issue #6, opened to
surface one). File it as a follow-up integration-tier test to be written when a concrete
server appears; do not block this ticket on it.

## User Stories

### As an operator with an OAuth-requiring MCP server, I complete its authorization through `McpAuth`

- Given an `mcpServers` entry with an `auth` block requiring `authorization_code`, when the
  agent calls `McpAuth({server, action:"begin"})`, then it returns the provider authorization
  URL and loopback redirect URI without blocking, rather than a stub error.
  → test: `src/agent/tools/mcp-auth.test.ts` › "begin returns authorization URL and redirect uri"
- Given a `begin` is in progress and the operator has visited the authorization URL (mock
  auto-approves), when the agent calls `McpAuth({server, action:"complete"})`, then the code
  is exchanged for tokens, the tokens are persisted, and the server's tools become callable.
  → test: `src/agent/tools/mcp-auth.test.ts` › "complete exchanges code, persists tokens, reconnects server"
- Given a server with a `client_credentials` `auth` block, when the agent calls
  `McpAuth({server, action:"begin"})`, then the grant completes inline in one call with no
  authorization URL.
  → test: `src/agent/tools/mcp-auth.test.ts` › "client_credentials completes in a single call"

### As an operator, I want stored tokens to refresh automatically and stay private

- Given a persisted expired access token with a valid refresh token, when the connection is
  (re)established, then the SDK refreshes it and the new tokens are written back, with no
  `McpAuth` call needed.
  → test: `src/agent/mcp/oauth-provider.test.ts` › "expired access token auto-refreshes and persists"
- Given a completed authorization, when the token file is written, then it is mode `0600`
  under a `0700` `~/.dh/mcp-auth/` dir, scoped per server, and no secret appears in any logged
  or returned string.
  → test: `src/agent/mcp/token-store.test.ts` › "writes 0600 per-server file, redacts secrets"

### As an agent, I get actionable status and honest errors

- Given various server states, when the agent calls `McpAuth({server, action:"status"})`, then
  it reports not-configured / needs-auth / pending / authenticated without error.
  → test: `src/agent/tools/mcp-auth.test.ts` › "status reports each auth state"
- Given a `complete` with no operator visit within the timeout, when it elapses, then it
  returns an actionable "still waiting" result (`isError:false`), not a harness failure.
  → test: `src/agent/tools/mcp-auth.test.ts` › "complete times out with actionable pending result"
- Given a returned `state` that does not match the one issued, when `complete` runs, then it
  rejects the callback as a CSRF mismatch.
  → test: `src/agent/tools/mcp-auth.test.ts` › "complete rejects state mismatch"
- Given a stdio (`command`) server configured with an `auth` block, when config is loaded,
  then it is rejected as a validation error.
  → test: `src/config/*` (config validation) › "stdio server with auth is a config error"

### As an operator, the loopback receiver adds no external surface

- Given an interactive `begin`, when the loopback receiver starts, then it binds `127.0.0.1`
  only (never the configured host / `0.0.0.0`) and is torn down after `complete`.
  → test: `src/agent/mcp/oauth-loopback.test.ts` › "binds loopback only and closes after use"

## Config extension (architect-approved, Fable)

Add to `src/contracts/config.type.ts`:

```ts
export interface McpServerAuthConfig {
  /** Grant type. Default "authorization_code" (interactive, PKCE). "client_credentials" is
   * the non-interactive machine-to-machine grant and requires clientId + clientSecret. */
  grant?: "authorization_code" | "client_credentials";
  /** OAuth scopes to request. Optional — the server's protected-resource metadata may imply them. */
  scopes?: string[];
  /** Pre-registered client credentials, skipping RFC 7591 dynamic registration.
   * Omitted => attempt dynamic client registration. Supports $(VAR) interpolation; never logged. */
  clientId?: string;
  clientSecret?: string;
  /** Fixed loopback redirect port for the authorization_code flow. Omitted => ephemeral. */
  redirectPort?: number;
}

export interface McpServerConfig {
  // ...existing fields...
  /** DH-0057: OAuth 2.1 auth for a URL-transport MCP server. Invalid on a `command` (stdio)
   * server (config error). Presence causes the connection's transport to be built with an
   * `authProvider`, enabling auto-refresh and McpAuth-driven authorization. */
  auth?: McpServerAuthConfig;
}
```

## Notes

> [!NOTE]
> Split from DH-0002 (owner decision, 2026-07-15). Re-activated by owner 2026-07-19 and
> designed against the MCP spec's generic OAuth 2.1 conventions rather than a specific vendor.

> [!NOTE]
> Public GitHub issue tracking real-server demand / an eventual integration-tier target:
> https://github.com/stefanrusek/dark-harness/issues/6

> [!NOTE]
> 2026-07-19 (Fable): kept as one ticket — the pieces (provider, token store, loopback
> receiver, tool contract, connection/manager wiring) are one cohesive, all-Core feature; a
> "generic infra vs. provider wiring" split has no clean seam because there is no specific
> provider to wire. The single shared-schema edit (`McpServerConfig.auth`) is approved here
> per §6 trigger 2. The only genuinely deferrable slice is the live-provider integration-tier
> test (§7), which is not a blocker on landing the mocked core.
