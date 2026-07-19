// Test-only fixture (DH-0057): a self-contained mock OAuth 2.1 authorization server + a
// bearer-gated MCP server, sibling in spirit to the stdio fixtures. It lets the OAuth flow
// tests exercise the REAL SDK client (discovery → DCR → PKCE → exchange/refresh →
// authenticated MCP calls) with no external network — the SDK speaks plain HTTP to endpoints
// this fixture hosts.
//
// Endpoints (any `.well-known/*` path variant the SDK's fallback probing tries is matched by
// prefix):
//   GET  /.well-known/oauth-protected-resource[...]   RFC 9728 protected-resource metadata
//   GET  /.well-known/oauth-authorization-server[...]  RFC 8414 authorization-server metadata
//   POST /register                                     RFC 7591 dynamic client registration
//   GET  /authorize                                    auto-approves: 302 to redirect_uri w/ code+state
//   POST /token                                        authorization_code | refresh_token | client_credentials
//   POST /mcp                                          bearer-gated MCP Streamable HTTP endpoint
//
// The MCP surface uses the SDK's *server* half (permitted in a test fixture — the "never
// import the server half" rule is a product-code constraint, see fake-stdio-server.ts).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface MockOAuthServer {
  /** Base origin, e.g. "http://127.0.0.1:PORT". */
  readonly origin: string;
  /** The MCP server URL (what `mcpServers[x].url` points at). */
  readonly mcpUrl: string;
  /** Every authorization code this server has issued (for assertions). */
  readonly issuedCodes: string[];
  /** Access tokens the server currently accepts as valid bearers. */
  readonly validAccessTokens: Set<string>;
  /** Refresh tokens the server currently accepts. */
  readonly validRefreshTokens: Set<string>;
  /** Force the next /token response to be an OAuth error (for error-path tests). */
  failNextToken: boolean;
  stop(): Promise<void>;
}

let tokenCounter = 0;
function newToken(prefix: string): string {
  tokenCounter += 1;
  return `${prefix}_${tokenCounter}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Starts the mock server on an ephemeral loopback port. */
export function startMockOAuthServer(): MockOAuthServer {
  const issuedCodes: string[] = [];
  const validAccessTokens = new Set<string>();
  const validRefreshTokens = new Set<string>();
  const state = { failNextToken: false };

  // The MCP server half — two tools, both requiring a valid bearer to have been attached
  // (enforced in the fetch handler before delegating to the transport). Stateless mode
  // requires a fresh McpServer + transport per request (the SDK rejects reuse).
  function buildMcpServer(): McpServer {
    const mcp = new McpServer({ name: "mock-mcp", version: "0.1.0" });
    mcp.registerTool("ping", { description: "Returns pong.", inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    mcp.registerTool(
      "echo",
      { description: "Echoes text.", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
    );
    return mcp;
  }

  async function handleMcp(req: Request): Promise<Response> {
    const mcp = buildMcpServer();
    // Stateless mode: omitting sessionIdGenerator leaves it undefined (the SDK's stateless
    // signal) without tripping exactOptionalPropertyTypes on a literal `undefined`.
    const transport = new WebStandardStreamableHTTPServerTransport({});
    await mcp.connect(transport);
    const res = await transport.handleRequest(req);
    return res;
  }

  let origin = "";

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path.startsWith("/.well-known/oauth-protected-resource")) {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
        });
      }

      if (path.startsWith("/.well-known/oauth-authorization-server")) {
        return json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        });
      }

      if (path === "/register" && req.method === "POST") {
        const meta = (await req.json()) as { redirect_uris?: string[] };
        return json(
          {
            client_id: newToken("client"),
            client_secret: newToken("secret"),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            redirect_uris: meta.redirect_uris ?? [],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          },
          201,
        );
      }

      if (path === "/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri");
        const reqState = url.searchParams.get("state") ?? "";
        if (!redirectUri) return json({ error: "invalid_request" }, 400);
        const code = newToken("code");
        issuedCodes.push(code);
        const location = new URL(redirectUri);
        location.searchParams.set("code", code);
        location.searchParams.set("state", reqState);
        return new Response(null, { status: 302, headers: { location: location.toString() } });
      }

      if (path === "/token" && req.method === "POST") {
        if (state.failNextToken) {
          state.failNextToken = false;
          return json({ error: "invalid_grant", error_description: "simulated failure" }, 400);
        }
        const form = new URLSearchParams(await req.text());
        const grantType = form.get("grant_type");
        if (grantType === "authorization_code") {
          const code = form.get("code");
          if (!code || !issuedCodes.includes(code)) {
            return json({ error: "invalid_grant" }, 400);
          }
          const access = newToken("access");
          const refresh = newToken("refresh");
          validAccessTokens.add(access);
          validRefreshTokens.add(refresh);
          return json({
            access_token: access,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: refresh,
            scope: "mcp:tools",
          });
        }
        if (grantType === "refresh_token") {
          const refresh = form.get("refresh_token");
          if (!refresh || !validRefreshTokens.has(refresh)) {
            return json({ error: "invalid_grant" }, 400);
          }
          const access = newToken("access");
          validAccessTokens.add(access);
          return json({
            access_token: access,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "mcp:tools",
          });
        }
        if (grantType === "client_credentials") {
          const access = newToken("access");
          validAccessTokens.add(access);
          return json({
            access_token: access,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "mcp:tools",
          });
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }

      if (path === "/mcp") {
        const authz = req.headers.get("authorization") ?? "";
        const bearer = authz.replace(/^Bearer\s+/i, "");
        if (!bearer || !validAccessTokens.has(bearer)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: {
              "content-type": "application/json",
              "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
            },
          });
        }
        return handleMcp(req);
      }

      return new Response("not found", { status: 404 });
    },
  });

  origin = `http://127.0.0.1:${server.port}`;

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    issuedCodes,
    validAccessTokens,
    validRefreshTokens,
    get failNextToken() {
      return state.failNextToken;
    },
    set failNextToken(v: boolean) {
      state.failNextToken = v;
    },
    async stop() {
      await server.stop(true);
    },
  };
}
