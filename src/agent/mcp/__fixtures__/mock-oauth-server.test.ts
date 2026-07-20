// DH-0057: exercises the mock OAuth+MCP fixture's error/edge branches directly, mirroring the
// fixture-coverage.test.ts pattern (DH-0149) so every line of the fixture runs under coverage.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type MockOAuthServer, startMockOAuthServer } from "./mock-oauth-server.ts";

let mock: MockOAuthServer;
beforeEach(() => {
  mock = startMockOAuthServer();
});
afterEach(async () => {
  await mock.stop();
});

describe("mock-oauth-server fixture error branches", () => {
  test("/authorize without redirect_uri is a 400", async () => {
    const res = await fetch(`${mock.origin}/authorize`);
    expect(res.status).toBe(400);
  });

  test("/register without redirect_uris still issues a client", async () => {
    const res = await fetch(`${mock.origin}/register`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { client_id?: string }).client_id).toBeDefined();
  });

  test("/token failNextToken returns an OAuth error once", async () => {
    mock.failNextToken = true;
    expect(mock.failNextToken).toBe(true);
    const res = await fetch(`${mock.origin}/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("invalid_grant");
    expect(mock.failNextToken).toBe(false);
  });

  test("/token authorization_code with an unknown code is invalid_grant", async () => {
    const res = await fetch(`${mock.origin}/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  test("/token refresh_token with an unknown token is invalid_grant", async () => {
    const res = await fetch(`${mock.origin}/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  test("/token unsupported grant type is rejected", async () => {
    const res = await fetch(`${mock.origin}/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "password" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("unsupported_grant_type");
  });

  test("/mcp without a bearer is a 401 carrying resource metadata", async () => {
    const res = await fetch(`${mock.mcpUrl}`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  test("an unknown path is a 404", async () => {
    const res = await fetch(`${mock.origin}/nowhere`);
    expect(res.status).toBe(404);
  });

  test("client_credentials issues an access token accepted as a bearer", async () => {
    const res = await fetch(`${mock.origin}/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    const body = (await res.json()) as { access_token: string };
    expect(mock.validAccessTokens.has(body.access_token)).toBe(true);
  });
});
