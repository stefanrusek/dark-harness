// HTTP+SSE server (ADR 0002), security wrapper (ADR 0004), and JSONL logging wiring
// (ADR 0005) for one dh session. Route contract (fleet's call, per docs/handoffs/server.md
// — documented here for the TUI/Web domains to build their clients against):
//
//   GET  /api/events    SSE stream of ServerSentEvent, honors `Last-Event-ID` for resume.
//   POST /api/commands  JSON body of a ClientCommand; JSON or binary (log download) response.
//
// Never serves the web UI's static assets (ADR 0003) — API/event protocol only.

import { readFileSync } from "node:fs";
import type { ClientCommand, SecurityConfig, ServerSentEvent } from "../contracts/index.ts";
import type { AgentLoopHandle } from "./agent-loop.ts";
import { isAuthorized } from "./auth.ts";
import { handleCommand } from "./commands.ts";
import { EventBuffer } from "./event-buffer.ts";
import { SessionLogger } from "./logger.ts";
import { formatSseEvent } from "./sse.ts";

const DEFAULT_PORT = 4000;
const EVENTS_PATH = "/api/events";
const COMMANDS_PATH = "/api/commands";
// Round 2: real interactive testing (both TUI and Web UI) confirmed idle SSE connections
// get dropped and reconnected — something in the network path (browser, OS, or an
// intermediate proxy; the server side can't tell which) decides a quiet connection is
// stale during a slow model turn or the idle stretch between messages. A periodic
// keep-alive comment line resets whatever idle timer is doing that. 20s sits in the
// typical 15-30s range for this kind of heartbeat: comfortably under common intermediary
// idle-timeout defaults (many L7 proxies/load balancers default around 60s), without being
// so frequent it's meaningful overhead on an otherwise-quiet connection.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
// Backpressure threshold (DH-0019): once a stream controller's `desiredSize` (bytes still
// wanted under the queue's high-water mark) drops below this, the consumer isn't draining
// fast enough and the connection is closed rather than left to buffer unboundedly.
const MAX_NEGATIVE_DESIRED_SIZE = -50;

// Permissive CORS: `dh --connect <host> --web` runs the web UI as a separate local
// process/origin talking to a remote `--server` (ADR 0003), so cross-origin browser
// requests are the expected common case, not an edge case. This relaxes only the
// browser's same-origin policy — it grants no capability a non-browser client (curl, the
// console TUI) didn't already have, so it does not touch the ADR 0004 security posture
// (bearer token / TLS remain the actual admission controls). `*` is safe here because the
// protocol never relies on cookies/credentialed requests.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, Last-Event-ID",
  // Cross-origin fetch() can't read a response header unless it's explicitly exposed — the
  // web UI needs Content-Disposition to name downloaded log files correctly (ADR 0003: the
  // web UI and dh server are different origins even in local --web mode). Found by the E2E
  // domain's real cross-origin browser test; see docs/handoffs/e2e.md's status log.
  "access-control-expose-headers": "Content-Disposition",
  "access-control-max-age": "86400",
};

export interface DhServerOptions {
  agentLoop: AgentLoopHandle;
  sessionId: string;
  logDir: string;
  /** Default 4000 (HANDOFF.md §2), overridable — the CLI wires `--port` here. */
  port?: number;
  security?: SecurityConfig;
  /** SSE resume retention window in event count. Default 1000 — see EventBuffer's doc. */
  eventBufferSize?: number;
  /** SSE resume retention window in total serialized bytes (DH-0012). Default 10MB — see
   * EventBuffer's doc. */
  eventBufferMaxBytes?: number;
  /**
   * Interval, in ms, between `: ping` keep-alive comments sent on every open SSE
   * connection. Default `DEFAULT_HEARTBEAT_INTERVAL_MS` (20s). Test-only knob — production
   * callers should not need to override this.
   */
  heartbeatIntervalMs?: number;
  /**
   * DH-0020: known real secret values (config `security.token`, provider `apiKey`s, MCP
   * header values) redacted verbatim from every JSONL log line, in addition to the
   * pattern-based redaction `SessionLogger`/`redactSecrets` always applies. Threaded
   * straight to `SessionLogger`'s constructor. Typically built via
   * `collectConfigSecrets(config)` at the call site (Core's `cli.ts`).
   */
  knownSecrets?: readonly string[];
}

export class DhServer {
  private readonly agentLoop: AgentLoopHandle;
  private readonly sessionId: string;
  private readonly logger: SessionLogger;
  private readonly eventBuffer: EventBuffer;
  private readonly security: SecurityConfig | undefined;
  private readonly requestedPort: number;
  private readonly heartbeatIntervalMs: number;
  private bunServer: ReturnType<typeof Bun.serve> | undefined;
  private unsubscribeEvent: (() => void) | undefined;
  private unsubscribeLog: (() => void) | undefined;
  private resyncSeq = 0;

  constructor(options: DhServerOptions) {
    this.agentLoop = options.agentLoop;
    this.sessionId = options.sessionId;
    this.logger = new SessionLogger(options.logDir, options.knownSecrets);
    this.eventBuffer = new EventBuffer(options.eventBufferSize, options.eventBufferMaxBytes);
    this.security = options.security;
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Starts listening and returns the bound port (useful when `port: 0` is requested). */
  start(): number {
    // Global subscriptions, independent of any single SSE connection: buffer every event
    // for resume, and persist every log line as a side effect (ADR 0005 — agents never
    // call a logging tool themselves).
    this.unsubscribeEvent = this.agentLoop.onEvent((event) => this.eventBuffer.push(event));
    this.unsubscribeLog = this.agentLoop.onLog((agentId, line) =>
      this.logger.append(agentId, line),
    );

    const tls = this.buildTlsOption();
    this.bunServer = Bun.serve({
      port: this.requestedPort,
      ...(tls ? { tls } : {}),
      fetch: (req) => this.handleFetch(req),
    });
    // Bun.serve()'s `.port` is typed `number | undefined` to cover unix-socket servers;
    // we always pass a numeric `port` option (never `unix`), so it is always bound to a
    // real TCP port here.
    return this.bunServer.port as number;
  }

  stop(): void {
    this.unsubscribeEvent?.();
    this.unsubscribeLog?.();
    this.bunServer?.stop(true);
  }

  get port(): number | undefined {
    return this.bunServer?.port;
  }

  get protocol(): "http" | "https" {
    return this.security?.tls ? "https" : "http";
  }

  private buildTlsOption(): { cert: string; key: string } | undefined {
    if (!this.security?.tls) return undefined;
    return {
      cert: readFileSync(this.security.tls.cert, "utf8"),
      key: readFileSync(this.security.tls.key, "utf8"),
    };
  }

  private async handleFetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!isAuthorized(req.headers.get("Authorization"), this.security?.token)) {
      return new Response(null, { status: 401, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (url.pathname === EVENTS_PATH && req.method === "GET") {
      return this.handleSse(req);
    }

    if (url.pathname === COMMANDS_PATH && req.method === "POST") {
      return this.handleCommandRequest(req);
    }

    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }

  private handleSse(req: Request): Response {
    const lastEventId = req.headers.get("Last-Event-ID");
    const { events: replay, gap } = this.eventBuffer.getEventsAfter(lastEventId);
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    // Cleanup is idempotent and reachable from three places: `cancel()` (client-initiated
    // disconnect, the common case), and both `safeEnqueue`'s catch and the backpressure
    // check below (server-initiated close of an unresponsive consumer) — see the
    // DH-0019 notes on the bare `catch {}` not reliably unsubscribing.
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      clearInterval(heartbeat);
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // A backpressure-aware enqueue: `desiredSize` goes negative once the stream's
        // internal queue has more already-enqueued bytes than its high-water mark wants.
        // A slow consumer (bad network, paused/backgrounded browser tab) that never drains
        // would otherwise let that queue grow unbounded, since `controller.enqueue` itself
        // doesn't block or reject on backpressure. Past a generous negative threshold we
        // treat the connection as unresponsive and close it outright rather than keep
        // buffering server-side memory for it — the client's own SSE reconnect (with
        // `Last-Event-ID`) is the recovery path, same as any other disconnect.
        const safeEnqueue = (bytes: Uint8Array): void => {
          if (closed) return;
          const desiredSize = controller.desiredSize;
          if (desiredSize !== null && desiredSize < MAX_NEGATIVE_DESIRED_SIZE) {
            try {
              controller.close();
            } catch {
              // Already closing/closed; fall through to cleanup regardless.
            }
            cleanup();
            return;
          }
          try {
            controller.enqueue(bytes);
          } catch {
            // Enqueue failed for any reason (closed controller, or otherwise) — treat it
            // as a disconnect and clean up here rather than relying solely on `cancel()`,
            // which some Bun/runtime paths don't reliably invoke after an enqueue throw.
            cleanup();
          }
        };

        // A leading SSE comment (lines starting with ':' are ignored by any conforming
        // client, per the SSE spec) forces an immediate flush of the response headers and
        // first bytes. Without it, a connection with nothing yet to replay never sends a
        // byte until the first live event — which leaves the client's `fetch()`/
        // `EventSource` connection promise unresolved (and the underlying socket
        // indistinguishable from a hang) until then.
        safeEnqueue(encoder.encode(": connected\n\n"));
        if (gap) {
          // `lastEventId` was given but unknown (evicted, or the server restarted) — tell
          // the client its resume is best-effort so it can surface "history may be
          // incomplete" instead of looking like a clean resume (DH-0019).
          safeEnqueue(encoder.encode(formatSseEvent(this.buildResyncEvent())));
        }
        for (const event of replay) {
          safeEnqueue(encoder.encode(formatSseEvent(event)));
        }
        unsubscribe = this.agentLoop.onEvent((event: ServerSentEvent) => {
          safeEnqueue(encoder.encode(formatSseEvent(event)));
        });
        // Periodic keep-alive so idle connections don't get dropped (see Round 2 notes on
        // DEFAULT_HEARTBEAT_INTERVAL_MS above). A comment line — no `id:` field — so it
        // never touches `Last-Event-ID`/`EventBuffer` resume semantics.
        heartbeat = setInterval(() => {
          safeEnqueue(encoder.encode(": ping\n\n"));
        }, this.heartbeatIntervalMs);
      },
      cancel: cleanup,
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  /** Synthesizes a `resync` event with a unique id, distinct from any real event's id so it
   * can never collide in `EventBuffer`/`Last-Event-ID` bookkeeping (it is never itself
   * buffered — it's constructed fresh per connection and only ever written to the wire). */
  private buildResyncEvent(): ServerSentEvent {
    this.resyncSeq++;
    return {
      version: 1,
      id: `resync-${Date.now()}-${this.resyncSeq}`,
      timestamp: new Date().toISOString(),
      type: "resync",
    };
  }

  private async handleCommandRequest(req: Request): Promise<Response> {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return Response.json(
        { ok: false, error: "invalid JSON body" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const result = handleCommand(parsed as ClientCommand, {
      agentLoop: this.agentLoop,
      logger: this.logger,
      sessionId: this.sessionId,
    });

    if (result.kind === "json") {
      return Response.json(result.body, { status: result.status, headers: CORS_HEADERS });
    }

    return new Response(result.body, {
      status: result.status,
      headers: {
        ...CORS_HEADERS,
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.filename}"`,
      },
    });
  }
}
