// HTTP surface this client speaks against the Server domain's dh server.
//
// Route contract (reconciled against Radia's actual Server implementation — see
// docs/handoffs/web.md status log for the reconciliation note):
//
// - SSE stream:      GET  {baseUrl}{SSE_PATH}      — honors a `Last-Event-ID` header.
// - Commands:        POST {baseUrl}{COMMAND_PATH}  body: ClientCommand (JSON)
//
// Auth: both the SSE stream and command POSTs authenticate with a real
// `Authorization: Bearer <token>` header — never a `?token=` query parameter, which would
// leak into proxy/access logs. Native browser `EventSource` cannot set custom headers at
// all, which is *why* client/sse.ts speaks the SSE wire format itself over `fetch()`
// instead of using `EventSource` (see that file's header comment for the full rationale).
//
// CORS: ADR 0003 means the web UI is served by a different process (and typically a
// different port) than the target dh server, even in `dh --web` local mode. Every request
// from this client is therefore cross-origin by default; Server sends permissive CORS
// headers and answers `OPTIONS` preflight to make this work.

export const SSE_PATH = "/api/events";
export const COMMAND_PATH = "/api/commands";

export interface ServerTarget {
  /** Origin the dh server is reachable at, e.g. "http://localhost:4000". No trailing slash. */
  baseUrl: string;
  /** Bearer token, when the target server has `security.token` configured. */
  token?: string | undefined;
}

export function sseUrl(target: ServerTarget): string {
  return new URL(SSE_PATH, target.baseUrl).toString();
}

export function commandUrl(target: ServerTarget): string {
  return new URL(COMMAND_PATH, target.baseUrl).toString();
}

/**
 * Local, same-origin endpoint served by `serveWebUi` (server.ts) itself — not the target dh
 * server. The browser fetches this on boot to learn which dh server to talk to and which
 * bearer token to use, since that's only known to the client process (`--connect <host>` /
 * `dh.json`'s `security.token`), not baked into the static bundle at build time.
 */
export const WEB_CONFIG_PATH = "/dh-config.json";

export interface WebConfigResponse {
  baseUrl: string;
  token?: string;
}
