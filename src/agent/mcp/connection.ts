// One MCP server connection (DH-0002). Wraps the official `@modelcontextprotocol/sdk`
// client (never its server half — client-entrypoint imports only, per the ticket's
// dependency constraint) plus transport selection from a single McpServerConfig entry:
// `command` present -> stdio transport; `url` present -> Streamable HTTP, falling back to
// the legacy HTTP+SSE transport if the modern one fails to initialize (the documented MCP
// SDK client migration pattern for servers that still only speak the older dialect).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "../../contracts/index.ts";
import { DhOAuthProvider } from "./oauth-provider.ts";
import { McpTokenStore } from "./token-store.ts";

/** Default per-server connect timeout (§6/§3 of DH-0002) — overridable via
 * `McpServerConfig.timeoutMs`. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** Default per-call tool-invocation timeout (§6) — overridable via
 * `McpServerConfig.timeoutMs`. */
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type McpConnectionState = "connected" | "failed" | "closed";

/** Minimal shape of a discovered MCP tool — carried verbatim from `tools/list`. */
export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** Result of a `callTool` invocation, in the SDK's own (loose) result shape — the caller
 * (`mcp/tools.ts`) adapts this into this project's `ToolResult`. */
export interface McpCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

/** Manages exactly one configured MCP server's connection lifecycle: transport selection,
 * connect/close, tool discovery, and tool invocation with a per-call timeout. Connection
 * state and the last error are tracked here so `McpManager` (and, transitively, ToolSearch's
 * unreachable-servers footer) can report them without re-deriving anything. */
export class McpConnection {
  readonly serverName: string;
  private readonly config: McpServerConfig;
  private client: Client | undefined;
  private _state: McpConnectionState = "closed";
  private _lastError: string | undefined;
  /** DH-0057: one OAuth provider instance for this connection's whole lifetime (so refresh
   * persistence and an in-flight interactive flow's state stay coherent). Present only for a
   * URL-transport server with an `auth` block. */
  readonly oauthProvider: DhOAuthProvider | undefined;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
    if (config.auth && config.url) {
      this.oauthProvider = new DhOAuthProvider(
        serverName,
        config.url,
        config.auth,
        new McpTokenStore(serverName),
      );
    }
  }

  get state(): McpConnectionState {
    return this._state;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  /** DH-0057: the configured server URL (URL-transport only), for the OAuth `auth()` driver. */
  get serverUrl(): string | undefined {
    return this.config.url;
  }

  /** DH-0057: the resolved grant type, or undefined when no `auth` block is configured. */
  get authGrant(): "authorization_code" | "client_credentials" | undefined {
    if (!this.config.auth) return undefined;
    return this.config.auth.grant ?? "authorization_code";
  }

  /** DH-0057: the configured fixed loopback redirect port, or undefined for an ephemeral one. */
  get authRedirectPort(): number | undefined {
    return this.config.auth?.redirectPort;
  }

  private get connectTimeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  private get callTimeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  private buildTransport(preferLegacySse: boolean) {
    if (this.config.command) {
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        ...(this.config.env !== undefined ? { env: this.config.env } : {}),
      });
    }
    if (this.config.url) {
      const url = new URL(this.config.url);
      const requestInit = this.config.headers ? { headers: this.config.headers } : undefined;
      // DH-0057: when an `auth` block is set, hand the transport the OAuth provider so the SDK
      // attaches the stored access token, auto-refreshes it via the refresh token, and
      // surfaces UnauthorizedError when interactive re-authorization is required.
      const authProvider = this.oauthProvider;
      const sseOpts = {
        ...(requestInit ? { requestInit } : {}),
        ...(authProvider ? { authProvider } : {}),
      };
      const httpOpts = {
        ...(requestInit ? { requestInit } : {}),
        ...(authProvider ? { authProvider } : {}),
      };
      if (preferLegacySse) {
        return Object.keys(sseOpts).length > 0
          ? new SSEClientTransport(url, sseOpts)
          : new SSEClientTransport(url);
      }
      return Object.keys(httpOpts).length > 0
        ? new StreamableHTTPClientTransport(url, httpOpts)
        : new StreamableHTTPClientTransport(url);
    }
    throw new Error(
      `MCP server "${this.serverName}" config has neither "command" nor "url" — nothing to connect to.`,
    );
  }

  /** Connects, bounded by `connectTimeoutMs`. Never throws — on any failure (bad command,
   * timeout, handshake error, both HTTP dialects failing) marks this connection `failed`
   * with `lastError` set and returns, letting `McpManager` proceed with every other server
   * (DH-0002 §6: startup never aborts because one server is unreachable). */
  async connect(): Promise<void> {
    const attempt = async (preferLegacySse: boolean) => {
      const client = new Client({ name: "dh", version: "0.1.0" });
      const transport = this.buildTransport(preferLegacySse);
      await withTimeout(
        client.connect(transport as Transport),
        this.connectTimeoutMs,
        `connect to MCP server "${this.serverName}" timed out after ${this.connectTimeoutMs}ms`,
      );
      return client;
    };

    try {
      this.client = this.config.url
        ? await attempt(false).catch(async (streamableErr) => {
            // Documented client migration fallback: a `url`-configured server that fails
            // the modern Streamable HTTP handshake may still speak the legacy HTTP+SSE
            // transport — try that before giving up.
            try {
              return await attempt(true);
            } catch {
              throw streamableErr;
            }
          })
        : await attempt(false);
      this._state = "connected";
      this._lastError = undefined;
    } catch (err) {
      this._state = "failed";
      this._lastError = (err as Error).message;
      this.client = undefined;
    }
  }

  /** Lists this server's tools. Throws if not currently connected — callers (`McpManager`)
   * only call this right after a successful `connect()`. */
  async listTools(): Promise<McpDiscoveredTool[]> {
    if (!this.client) {
      throw new Error(`MCP server "${this.serverName}" is not connected.`);
    }
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      inputSchema: (t.inputSchema ?? { type: "object" }) as McpDiscoveredTool["inputSchema"],
    }));
  }

  /** Invokes one tool with a per-call timeout. On timeout or any transport error, marks
   * this connection `failed` (so the next call attempts a reconnect first — DH-0002 §6's
   * "connection dies mid-session" behavior) and rethrows; `mcp/tools.ts`'s adapter turns
   * this into `ToolResult { isError: true }` rather than letting it reach the agent loop
   * uncaught. */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.client) {
      throw new Error(`MCP server "${this.serverName}" is not connected.`);
    }
    try {
      const result = await withTimeout(
        this.client.callTool({ name: toolName, arguments: args }),
        this.callTimeoutMs,
        `call to "${toolName}" on MCP server "${this.serverName}" timed out after ${this.callTimeoutMs}ms`,
      );
      return result as McpCallResult;
    } catch (err) {
      this._state = "failed";
      this._lastError = (err as Error).message;
      throw err;
    }
  }

  /** Forces this connection into the `failed` state with the given error — used by
   * `McpManager` when a connect() succeeds but the immediately-following `listTools()`
   * discovery call fails, which should be treated the same as an unreachable server rather
   * than silently leaving a connected-but-toolless entry. */
  markFailed(error: string): void {
    this._state = "failed";
    this._lastError = error;
  }

  /** Closes the connection (terminates a stdio child process, if any). Idempotent. */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // best-effort — already dead or never fully connected.
      }
      this.client = undefined;
    }
    this._state = "closed";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
