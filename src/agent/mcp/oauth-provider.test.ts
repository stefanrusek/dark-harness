// DH-0057: DhOAuthProvider — persistence-backed OAuthClientProvider, and the auto-refresh
// path driven through a real connection against the mock OAuth+MCP server.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerAuthConfig } from "../../contracts/index.ts";
import { startMockOAuthServer } from "./__fixtures__/mock-oauth-server.ts";
import { McpManager } from "./manager.ts";
import { DhOAuthProvider } from "./oauth-provider.ts";
import { McpTokenStore } from "./token-store.ts";

let home: string;
const prevDhHome = process.env.DH_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dh-oauthprovider-"));
  process.env.DH_HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevDhHome === undefined) delete process.env.DH_HOME;
  else process.env.DH_HOME = prevDhHome;
});

function makeProvider(auth: McpServerAuthConfig): DhOAuthProvider {
  return new DhOAuthProvider(
    "acme",
    "https://mcp.acme.example/v1",
    auth,
    new McpTokenStore("acme"),
  );
}

describe("DhOAuthProvider unit", () => {
  test("authorization_code metadata, redirect url, and state", () => {
    const provider = makeProvider({ scopes: ["mcp:tools"] });
    // With no live loopback, a placeholder redirect keeps the SDK on the interactive/refresh
    // branch (never the machine-to-machine token path).
    expect(provider.redirectUrl).toBe("http://127.0.0.1/callback");
    expect(provider.clientMetadata.redirect_uris).toEqual(["http://127.0.0.1/callback"]);
    provider.loopbackRedirectUri = "http://127.0.0.1:5000/callback";
    expect(provider.redirectUrl).toBe("http://127.0.0.1:5000/callback");
    const meta = provider.clientMetadata;
    expect(meta.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.redirect_uris).toEqual(["http://127.0.0.1:5000/callback"]);
    expect(meta.scope).toBe("mcp:tools");
    expect(meta.token_endpoint_auth_method).toBe("none");
    const s1 = provider.state();
    expect(s1).toHaveLength(32);
    expect(provider.issuedState).toBe(s1);
  });

  test("client_credentials: no redirect url, machine grant metadata and token request", () => {
    const provider = makeProvider({
      grant: "client_credentials",
      clientId: "c",
      clientSecret: "s",
    });
    expect(provider.redirectUrl).toBeUndefined();
    expect(provider.clientMetadata.grant_types).toEqual(["client_credentials"]);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post");
    const params = provider.prepareTokenRequest("mcp:tools");
    expect(params?.get("grant_type")).toBe("client_credentials");
    expect(params?.get("scope")).toBe("mcp:tools");
    // No scope arg -> no scope param.
    expect(provider.prepareTokenRequest()?.get("scope")).toBeNull();
  });

  test("prepareTokenRequest returns undefined for authorization_code (SDK default path)", () => {
    const provider = makeProvider({});
    expect(provider.prepareTokenRequest("x")).toBeUndefined();
  });

  test("static client credentials win over stored DCR info", () => {
    const provider = makeProvider({ clientId: "static-id", clientSecret: "static-secret" });
    const info = provider.clientInformation();
    expect(info?.client_id).toBe("static-id");
    expect((info as { client_secret?: string }).client_secret).toBe("static-secret");
  });

  test("saveClientInformation persists DCR result read back by clientInformation", () => {
    const provider = makeProvider({});
    expect(provider.clientInformation()).toBeUndefined();
    provider.saveClientInformation({
      client_id: "dcr-id",
      redirect_uris: ["http://127.0.0.1:1/callback"],
    });
    expect(provider.clientInformation()?.client_id).toBe("dcr-id");
  });

  test("saveTokens stamps obtained_at and clears the code verifier", () => {
    const provider = makeProvider({});
    provider.saveCodeVerifier("verifier-xyz");
    expect(provider.codeVerifier()).toBe("verifier-xyz");
    provider.saveTokens({ access_token: "at", token_type: "Bearer", expires_in: 3600 });
    const store = new McpTokenStore("acme");
    expect(store.read()?.tokens?.obtained_at).toBeGreaterThan(0);
    expect(store.read()?.codeVerifier).toBeUndefined();
  });

  test("codeVerifier throws when none is stored", () => {
    const provider = makeProvider({});
    expect(() => provider.codeVerifier()).toThrow(/no PKCE code verifier/);
  });

  test("redirectToAuthorization records the URL without opening a browser; reset clears it", () => {
    const provider = makeProvider({});
    const url = new URL("https://auth.example/authorize?x=1");
    provider.redirectToAuthorization(url);
    expect(provider.pendingAuthorizationUrl?.toString()).toBe(url.toString());
    provider.state();
    provider.resetPendingAuth();
    expect(provider.pendingAuthorizationUrl).toBeUndefined();
    expect(provider.issuedState).toBeUndefined();
  });

  test("client_credentials without scopes omits scope from metadata", () => {
    const provider = makeProvider({
      grant: "client_credentials",
      clientId: "c",
      clientSecret: "s",
    });
    expect(provider.clientMetadata.scope).toBeUndefined();
  });
});

describe("auto-refresh (real connection against mock)", () => {
  test("expired access token auto-refreshes and persists", async () => {
    const mock = startMockOAuthServer();
    // Seed a token file with a stale access token the server will reject (401) and a refresh
    // token it accepts — the transport must refresh on connect and persist the new access.
    const store = new McpTokenStore("acme");
    mock.validRefreshTokens.add("good-refresh");
    store.write({
      serverName: "acme",
      serverUrl: mock.mcpUrl,
      clientInformation: { client_id: "cid", redirect_uris: [] },
      tokens: {
        access_token: "stale-access",
        token_type: "Bearer",
        refresh_token: "good-refresh",
        expires_in: 3600,
        obtained_at: Date.now() - 10_000,
      },
    });

    const manager = new McpManager({ acme: { url: mock.mcpUrl, auth: {} } });
    await manager.connectAll();

    // The connection came up (refresh succeeded) and tools are callable.
    const { tools, unreachable } = manager.listAllTools();
    expect(unreachable).toEqual([]);
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);

    // A brand-new access token was persisted (not the stale one), with a fresh obtained_at.
    const after = store.read();
    expect(after?.tokens?.access_token).not.toBe("stale-access");
    expect(mock.validAccessTokens.has(after?.tokens?.access_token ?? "")).toBe(true);

    await manager.close();
    await mock.stop();
  });
});
