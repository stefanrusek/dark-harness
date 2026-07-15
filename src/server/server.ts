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
}

export class DhServer {
  private readonly agentLoop: AgentLoopHandle;
  private readonly sessionId: string;
  private readonly logger: SessionLogger;
  private readonly eventBuffer: EventBuffer;
  private readonly security: SecurityConfig | undefined;
  private readonly requestedPort: number;
  private bunServer: ReturnType<typeof Bun.serve> | undefined;
  private unsubscribeEvent: (() => void) | undefined;
  private unsubscribeLog: (() => void) | undefined;

  constructor(options: DhServerOptions) {
    this.agentLoop = options.agentLoop;
    this.sessionId = options.sessionId;
    this.logger = new SessionLogger(options.logDir);
    this.eventBuffer = new EventBuffer(options.eventBufferSize ?? 1000);
    this.security = options.security;
    this.requestedPort = options.port ?? DEFAULT_PORT;
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
    const replay = this.eventBuffer.getEventsAfter(lastEventId);
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // A leading SSE comment (lines starting with ':' are ignored by any conforming
        // client, per the SSE spec) forces an immediate flush of the response headers and
        // first bytes. Without it, a connection with nothing yet to replay never sends a
        // byte until the first live event — which leaves the client's `fetch()`/
        // `EventSource` connection promise unresolved (and the underlying socket
        // indistinguishable from a hang) until then.
        controller.enqueue(encoder.encode(": connected\n\n"));
        for (const event of replay) {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        }
        unsubscribe = this.agentLoop.onEvent((event: ServerSentEvent) => {
          try {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
          } catch {
            // Controller already closed (client disconnected); cancel() below unsubscribes.
          }
        });
      },
      cancel: () => {
        unsubscribe?.();
      },
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
