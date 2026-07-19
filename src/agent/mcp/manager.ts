// McpManager (DH-0002): fans out over every configured `mcpServers` entry, connecting in
// parallel at runtime startup, caching discovered tools, and dispatching tool calls —
// degrading gracefully (never throwing) on any per-server failure (§6 of the ticket).

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServerConfig } from "../../contracts/index.ts";
import { type McpCallResult, McpConnection, type McpDiscoveredTool } from "./connection.ts";
import { type LoopbackReceiver, startLoopbackReceiver } from "./oauth-loopback.ts";
import type { StoredOAuthTokens } from "./token-store.ts";

/** Throttle window for the lazy reconnect a `failed` server gets when ToolSearch touches
 * the corpus — at most one attempt per this many ms per server (DH-0002 §6). */
export const RECONNECT_THROTTLE_MS = 60_000;

export interface McpToolDescriptor {
  serverName: string;
  name: string;
  description: string;
  inputSchema: McpDiscoveredTool["inputSchema"];
}

export interface UnreachableServer {
  name: string;
  error: string;
}

/** DH-0057: one of the auth states `McpAuth status` reports. */
export type McpAuthState =
  | "unknown" // no such mcpServers entry
  | "not-configured" // entry exists but has no `auth` block
  | "authenticated" // valid (or refreshable) tokens present
  | "pending" // a `begin` is awaiting its callback
  | "needs-auth"; // configured but no usable tokens

export interface McpAuthStatus {
  server: string;
  state: McpAuthState;
  /** epoch ms the access token expires (authenticated/pending), if known. */
  expiresAt?: number;
  /** re-echoed authorization URL while pending. */
  authorizationUrl?: string;
}

export interface McpAuthBeginResult {
  grant: "authorization_code" | "client_credentials";
  /** authorization_code only: the URL for the operator to open. */
  authorizationUrl?: string;
  /** authorization_code only: the loopback redirect URI. */
  redirectUri?: string;
  /** epoch ms of token expiry when the grant completed inline (client_credentials, or an
   * already-authenticated authorization_code server). */
  expiresAt?: number;
  /** true when tokens already existed / were obtained without an interactive step. */
  alreadyAuthenticated?: boolean;
}

export interface McpAuthCompleteResult {
  expiresAt?: number;
}

/** DH-0057: raised for an unknown server or one lacking an `auth` block — the tool maps these
 * to an informational (isError:false) message. */
export class McpAuthConfigError extends Error {
  constructor(
    message: string,
    readonly state: "unknown" | "not-configured",
  ) {
    super(message);
    this.name = "McpAuthConfigError";
  }
}

/** DH-0057: the callback `state` did not match the issued one — a CSRF rejection. */
export class McpAuthStateMismatchError extends Error {
  constructor() {
    super("authorization callback state did not match the issued state (possible CSRF)");
    this.name = "McpAuthStateMismatchError";
  }
}

/** DH-0057: `complete` was called with no `begin` in flight for the server. */
export class McpAuthNoFlowError extends Error {
  constructor(server: string) {
    super(`no authorization is in progress for MCP server "${server}" — call McpAuth begin first`);
    this.name = "McpAuthNoFlowError";
  }
}

/** epoch ms an access token expires, from dh's `obtained_at` stamp + `expires_in`. */
function tokenExpiresAt(tokens: StoredOAuthTokens | undefined): number | undefined {
  if (!tokens?.expires_in || !tokens.obtained_at) return undefined;
  return tokens.obtained_at + tokens.expires_in * 1000;
}

/** Spreadable `{ expiresAt }` (or empty) that satisfies exactOptionalPropertyTypes. */
function optionalExpiry(tokens: StoredOAuthTokens | undefined): { expiresAt?: number } {
  const at = tokenExpiresAt(tokens);
  return at !== undefined ? { expiresAt: at } : {};
}

/** Spreadable `{ authorizationUrl }` (or empty) from a possibly-undefined URL. */
function optionalAuthUrl(url: URL | undefined): { authorizationUrl?: string } {
  return url ? { authorizationUrl: url.toString() } : {};
}

/** Fans out over `Record<string, McpServerConfig>`, owning one `McpConnection` per
 * configured server for the lifetime of the owning `AgentRuntime` (shared by root and every
 * sub-agent — one connection per server per process, not per agent). */
export class McpManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly toolCache = new Map<string, McpDiscoveredTool[]>();
  private readonly lastReconnectAttempt = new Map<string, number>();
  /** Dedupes concurrent connect attempts against the same server — the runtime's eager,
   * fire-and-forget `connectAll()` at construction can race against a `ToolSearch` call's
   * own lazy-retry pass (`reconnectFailedServers()`) touching the same not-yet-connected
   * server; without this, both would spin up a second `McpConnection.connect()` for the
   * same server concurrently. */
  private readonly inFlightConnects = new Map<string, Promise<void>>();
  /** DH-0057: in-flight interactive OAuth flows — started by `beginAuth`, consumed by
   * `completeAuth`, keyed by server name. Presence == a `pending` auth state. */
  private readonly loopbackReceivers = new Map<string, LoopbackReceiver>();
  private readonly now: () => number;

  constructor(
    mcpServers: Record<string, McpServerConfig> | undefined,
    now: () => number = Date.now,
  ) {
    this.now = now;
    for (const [name, config] of Object.entries(mcpServers ?? {})) {
      this.connections.set(name, new McpConnection(name, config));
    }
  }

  /** Connects to every configured server in parallel. Never throws or rejects — an
   * individual server's connect failure is caught inside `McpConnection.connect()` itself
   * and only marks that one server `failed`; every other server still gets its chance. */
  async connectAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map((conn) => this.connectAndCache(conn)));
  }

  /** DH-0091: adds and connects servers discovered after construction — specifically, a
   * project's `.mcp.json`, read asynchronously by `AgentRuntime` alongside its own eager
   * `connectAll()` at startup. Any name already present (from `dh.json`'s own `mcpServers`,
   * passed to the constructor) is skipped entirely, never overwritten — that's what gives
   * `dh.json`'s definition precedence on a collision, per DH-0091's stated precedence rule.
   * Never throws — same "degrade gracefully per server" contract as `connectAll()`. */
  async addServers(servers: Record<string, McpServerConfig>): Promise<void> {
    const added: McpConnection[] = [];
    for (const [name, config] of Object.entries(servers)) {
      if (this.connections.has(name)) continue;
      const conn = new McpConnection(name, config);
      this.connections.set(name, conn);
      added.push(conn);
    }
    await Promise.all(added.map((conn) => this.connectAndCache(conn)));
  }

  private async connectAndCache(conn: McpConnection): Promise<void> {
    const existing = this.inFlightConnects.get(conn.serverName);
    if (existing) {
      await existing;
      return;
    }
    const attempt = this.doConnectAndCache(conn);
    this.inFlightConnects.set(conn.serverName, attempt);
    try {
      await attempt;
    } finally {
      this.inFlightConnects.delete(conn.serverName);
    }
  }

  private async doConnectAndCache(conn: McpConnection): Promise<void> {
    await conn.connect();
    if (conn.state === "connected") {
      try {
        const tools = await conn.listTools();
        this.toolCache.set(conn.serverName, tools);
      } catch (err) {
        // Discovery itself failed right after a successful handshake — treat like an
        // unreachable server rather than leaving a connected-but-toolless cache entry.
        this.toolCache.delete(conn.serverName);
        await conn.close().catch(() => {});
        conn.markFailed((err as Error).message);
        console.error(
          `dh: MCP server "${conn.serverName}" connected but tool discovery failed: ${(err as Error).message}`,
        );
      }
    } else {
      console.error(
        `dh: MCP server "${conn.serverName}" failed to connect: ${conn.lastError ?? "unknown error"}`,
      );
    }
  }

  /** Attempts one throttled reconnect for every server that isn't currently `connected` —
   * called when a `ToolSearch` query touches the corpus (DH-0002 §6's lazy-retry policy).
   * This deliberately includes servers still in their initial `closed` state (never yet
   * attempted), not just `failed` ones: the runtime's eager `connectAll()` at construction
   * is fire-and-forget, so a ToolSearch call racing ahead of it would otherwise never give
   * that server a first chance. Skips a server whose last attempt was less than
   * `RECONNECT_THROTTLE_MS` ago. Never throws. */
  async reconnectFailedServers(): Promise<void> {
    const nowMs = this.now();
    const candidates = [...this.connections.values()].filter((c) => c.state !== "connected");
    await Promise.all(
      candidates
        .filter((conn) => {
          const last = this.lastReconnectAttempt.get(conn.serverName);
          return last === undefined || nowMs - last >= RECONNECT_THROTTLE_MS;
        })
        .map(async (conn) => {
          this.lastReconnectAttempt.set(conn.serverName, nowMs);
          await this.connectAndCache(conn);
        }),
    );
  }

  /** All discovered tools across every currently-connected server, plus the set of
   * currently-unreachable servers with their last error — the exact shape ToolSearch's
   * footer needs, with no silent dropping of failure info. */
  listAllTools(): { tools: McpToolDescriptor[]; unreachable: UnreachableServer[] } {
    const tools: McpToolDescriptor[] = [];
    const unreachable: UnreachableServer[] = [];
    for (const conn of this.connections.values()) {
      if (conn.state === "connected") {
        const cached = this.toolCache.get(conn.serverName) ?? [];
        for (const t of cached) {
          tools.push({
            serverName: conn.serverName,
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.inputSchema,
          });
        }
      } else if (conn.state === "failed") {
        unreachable.push({ name: conn.serverName, error: conn.lastError ?? "unknown error" });
      }
    }
    return { tools, unreachable };
  }

  /** Dispatches a tool call to the named server. If the connection isn't currently
   * `connected` (dead mid-session, or never came up), attempts one reconnect first so a
   * previously-reachable server that dropped gets a real chance to recover before the call
   * is reported as failed (DH-0002 §6: "next call attempts one reconnect then errors
   * informatively"). Never throws uncaught into the agent loop's dispatch path — callers
   * (`mcp/tools.ts`) always wrap this in try/catch and map to `ToolResult`. */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`Unknown MCP server "${serverName}".`);
    }
    if (conn.state !== "connected") {
      await this.connectAndCache(conn);
    }
    if (conn.state !== "connected") {
      throw new Error(
        `MCP server "${serverName}" is unreachable: ${conn.lastError ?? "unknown error"}`,
      );
    }
    return conn.callTool(toolName, args);
  }

  /** DH-0057: rebuilds the named connection after a successful authorization so the
   * now-authenticated server's tools become discoverable. Thin wrapper over the existing
   * connect-and-cache path; never throws (same degrade-gracefully contract). */
  async reconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;
    await conn.close().catch(() => {});
    await this.connectAndCache(conn);
  }

  private requireAuthConnection(serverName: string): McpConnection {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new McpAuthConfigError(`Unknown MCP server "${serverName}".`, "unknown");
    }
    if (!conn.oauthProvider) {
      throw new McpAuthConfigError(
        `MCP server "${serverName}" has no "auth" block — nothing to authenticate.`,
        "not-configured",
      );
    }
    return conn;
  }

  /** DH-0057: reports the auth state of a server without error (informational). */
  authStatus(serverName: string): McpAuthStatus {
    const conn = this.connections.get(serverName);
    if (!conn) return { server: serverName, state: "unknown" };
    if (!conn.oauthProvider) return { server: serverName, state: "not-configured" };
    if (this.loopbackReceivers.has(serverName)) {
      return {
        server: serverName,
        state: "pending",
        ...optionalAuthUrl(conn.oauthProvider.pendingAuthorizationUrl),
      };
    }
    const tokens = conn.oauthProvider.tokens() as StoredOAuthTokens | undefined;
    if (tokens?.access_token) {
      return {
        server: serverName,
        state: "authenticated",
        ...optionalExpiry(tokens),
      };
    }
    return { server: serverName, state: "needs-auth" };
  }

  /** DH-0057: begins authorization. Non-blocking for `authorization_code` (returns the URL to
   * relay to the operator, leaving a loopback receiver in flight); runs the whole grant inline
   * for `client_credentials`. */
  async beginAuth(serverName: string): Promise<McpAuthBeginResult> {
    const conn = this.requireAuthConnection(serverName);
    const provider = conn.oauthProvider;
    if (!provider) throw new McpAuthConfigError(`Unknown MCP server "${serverName}".`, "unknown");
    const serverUrl = conn.serverUrl;
    if (!serverUrl) {
      throw new McpAuthConfigError(`MCP server "${serverName}" has no URL.`, "not-configured");
    }

    // Tear down any stale receiver from a previous, abandoned begin.
    await this.closeReceiver(serverName);

    if (conn.authGrant === "client_credentials") {
      provider.loopbackRedirectUri = undefined;
      await auth(provider, { serverUrl });
      const tokens = provider.tokens() as StoredOAuthTokens | undefined;
      return {
        grant: "client_credentials",
        alreadyAuthenticated: true,
        ...optionalExpiry(tokens),
      };
    }

    const receiver = startLoopbackReceiver(
      conn.authRedirectPort !== undefined ? { port: conn.authRedirectPort } : {},
    );
    provider.loopbackRedirectUri = receiver.redirectUri;
    provider.resetPendingAuth();
    try {
      const result = await auth(provider, { serverUrl });
      if (result === "AUTHORIZED") {
        // Existing tokens were still refreshable — no interactive step needed.
        await receiver.close();
        const tokens = provider.tokens() as StoredOAuthTokens | undefined;
        return {
          grant: "authorization_code",
          alreadyAuthenticated: true,
          ...optionalExpiry(tokens),
        };
      }
    } catch (err) {
      await receiver.close();
      throw err;
    }
    this.loopbackReceivers.set(serverName, receiver);
    return {
      grant: "authorization_code",
      redirectUri: receiver.redirectUri,
      ...optionalAuthUrl(provider.pendingAuthorizationUrl),
    };
  }

  /** DH-0057: blocks up to `timeoutMs` for the operator's redirect, then exchanges the code
   * for tokens (verifying CSRF `state`), reconnects the server, and reports token expiry. */
  async completeAuth(serverName: string, timeoutMs: number): Promise<McpAuthCompleteResult> {
    const conn = this.requireAuthConnection(serverName);
    const provider = conn.oauthProvider;
    const serverUrl = conn.serverUrl;
    if (!provider || !serverUrl) {
      throw new McpAuthConfigError(`Unknown MCP server "${serverName}".`, "unknown");
    }
    const receiver = this.loopbackReceivers.get(serverName);
    if (!receiver) throw new McpAuthNoFlowError(serverName);

    // waitForCode rejects with LoopbackTimeoutError on timeout — the tool maps that to an
    // actionable pending result and deliberately leaves the receiver in flight.
    const { code, state } = await receiver.waitForCode(timeoutMs);
    if (provider.issuedState !== undefined && state !== provider.issuedState) {
      throw new McpAuthStateMismatchError();
    }
    await auth(provider, { serverUrl, authorizationCode: code });
    await this.closeReceiver(serverName);
    await this.reconnect(serverName);
    const tokens = provider.tokens() as StoredOAuthTokens | undefined;
    return { ...optionalExpiry(tokens) };
  }

  private async closeReceiver(serverName: string): Promise<void> {
    const receiver = this.loopbackReceivers.get(serverName);
    if (receiver) {
      this.loopbackReceivers.delete(serverName);
      await receiver.close().catch(() => {});
    }
  }

  /** Closes every connection (terminates stdio children). Coordinates with the runtime's
   * own shutdown path (src/cli.ts's signal handling) rather than installing a second,
   * independent shutdown mechanism — see AgentRuntime.close(). */
  async close(): Promise<void> {
    for (const serverName of [...this.loopbackReceivers.keys()]) {
      await this.closeReceiver(serverName);
    }
    await Promise.all([...this.connections.values()].map((c) => c.close()));
  }
}
