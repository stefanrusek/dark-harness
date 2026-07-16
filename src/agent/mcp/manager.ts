// McpManager (DH-0002): fans out over every configured `mcpServers` entry, connecting in
// parallel at runtime startup, caching discovered tools, and dispatching tool calls —
// degrading gracefully (never throwing) on any per-server failure (§6 of the ticket).

import type { McpServerConfig } from "../../contracts/index.ts";
import { type McpCallResult, McpConnection, type McpDiscoveredTool } from "./connection.ts";

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

  /** Closes every connection (terminates stdio children). Coordinates with the runtime's
   * own shutdown path (src/cli.ts's signal handling) rather than installing a second,
   * independent shutdown mechanism — see AgentRuntime.close(). */
  async close(): Promise<void> {
    await Promise.all([...this.connections.values()].map((c) => c.close()));
  }
}
