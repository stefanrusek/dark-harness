// DH-0057: McpAuth tool — two-phase (begin/complete) + status contract, driven against the
// real McpManager and the mock OAuth+MCP server (no external network).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "../../contracts/index.ts";
import {
  type MockOAuthServer,
  startMockOAuthServer,
} from "../mcp/__fixtures__/mock-oauth-server.ts";
import { McpManager } from "../mcp/manager.ts";
import { mcpAuthTool } from "./mcp-auth.ts";
import { makeToolContext } from "./test-helpers.ts";
import type { ToolContext } from "./types.type.ts";

let home: string;
const prevDhHome = process.env.DH_HOME;
let mock: MockOAuthServer | undefined;
let manager: McpManager | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dh-mcpauth-"));
  process.env.DH_HOME = home;
});
afterEach(async () => {
  await manager?.close();
  await mock?.stop();
  manager = undefined;
  mock = undefined;
  rmSync(home, { recursive: true, force: true });
  if (prevDhHome === undefined) delete process.env.DH_HOME;
  else process.env.DH_HOME = prevDhHome;
});

function activeManager(): McpManager {
  if (!manager) throw new Error("no active manager");
  return manager;
}

function ctxFor(servers: Record<string, McpServerConfig>): ToolContext {
  manager = new McpManager(servers);
  const mgr = manager;
  return makeToolContext({
    mcpAuth: {
      status: (server) => mgr.authStatus(server),
      begin: (server) => mgr.beginAuth(server),
      complete: (server, timeoutMs) => mgr.completeAuth(server, timeoutMs),
    },
  });
}

/** The operator's "open the authorization URL" step: following it 302s to the loopback
 * receiver, which captures the code. */
async function visit(url: string): Promise<void> {
  await fetch(url);
}

describe("McpAuth tool: input validation", () => {
  test("rejects a missing server name", async () => {
    const ctx = ctxFor({});
    const result = await mcpAuthTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'server'");
  });

  test("rejects a non-string server", async () => {
    const ctx = ctxFor({});
    const result = await mcpAuthTool.execute({ server: 42 }, ctx);
    expect(result.isError).toBe(true);
  });
});

describe("McpAuth tool: authorization_code flow", () => {
  test("begin returns authorization URL and redirect uri", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const result = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain(`${mock.origin}/authorize`);
    expect(result.output).toMatch(
      /loopback callback is listening at http:\/\/127\.0\.0\.1:\d+\/callback/,
    );
    expect(result.output).toContain('"action": "complete"');
  });

  test("complete exchanges code, persists tokens, reconnects server", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    const complete = await completeP;
    expect(complete.isError).toBe(false);
    expect(complete.output).toContain("Authorization complete");
    const { tools } = activeManager().listAllTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);
    // The authenticated tools actually respond.
    const ping = await activeManager().callTool("acme", "ping", {});
    expect(JSON.stringify(ping)).toContain("pong");
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });

  test("bare McpAuth after begin defaults action to complete", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme" }, ctx); // no action -> pending -> complete
    await visit(authUrl);
    const complete = await completeP;
    expect(complete.output).toContain("Authorization complete");
  });

  test("complete times out with actionable pending result", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const result = await mcpAuthTool.execute(
      { server: "acme", action: "complete", timeoutMs: 60 },
      ctx,
    );
    expect(result.isError).toBe(false); // actionable pending, not a failure
    expect(result.output).toContain("Still waiting");
  });

  test("complete tolerates a one-shot token-endpoint hiccup from the authorization server", async () => {
    // The SDK's `auth()` helper retries a failed token exchange rather than surfacing it —
    // this exercises the mock fixture's one-shot `failNextToken` toggle (used elsewhere for
    // the fixture's own direct /token error-path assertions) through the real end-to-end
    // McpAuth flow, confirming the retry actually recovers rather than getting stuck.
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    mock.failNextToken = true;
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    const result = await completeP;
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Authorization complete");
    // The one-shot flag was consumed by the retried exchange, not left armed.
    expect(mock.failNextToken).toBe(false);
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });

  test("complete rejects state mismatch", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const redirectUri =
      /listening at (http:\/\/127\.0\.0\.1:\d+\/callback)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await fetch(`${redirectUri}?code=somecode&state=WRONG-STATE`);
    const result = await completeP;
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/state did not match/);
  });

  test("already-authenticated begin short-circuits with valid tokens", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    await completeP;
    const again = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    expect(again.isError).toBe(false);
    expect(again.output).toContain("already authenticated");
  });
});

describe("McpAuth tool: client_credentials flow", () => {
  test("client_credentials completes in a single call", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({
      acme: {
        url: mock.mcpUrl,
        auth: { grant: "client_credentials", clientId: "cid", clientSecret: "sec" },
      },
    });
    const result = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("client_credentials grant");
    expect(result.output).not.toContain("/authorize");
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });
});

describe("McpAuth tool: status", () => {
  test("status reports each auth state", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({
      acme: { url: mock.mcpUrl, auth: {} },
      plain: { url: mock.mcpUrl },
    });

    const unknown = await mcpAuthTool.execute({ server: "nope", action: "status" }, ctx);
    expect(unknown.isError).toBe(false);
    expect(unknown.output).toContain("not in the mcpServers config");

    const notConfigured = await mcpAuthTool.execute({ server: "plain", action: "status" }, ctx);
    expect(notConfigured.output).toContain('has no "auth" block');

    // default action (nothing pending) => status
    const needsAuth = await mcpAuthTool.execute({ server: "acme" }, ctx);
    expect(needsAuth.output).toContain("needs authorization");

    await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const pending = await mcpAuthTool.execute({ server: "acme", action: "status" }, ctx);
    expect(pending.output).toContain("authorization in progress");
    expect(pending.output).toContain(`${mock.origin}/authorize`);

    const begin2 = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin2.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    await completeP;
    const authed = await mcpAuthTool.execute({ server: "acme", action: "status" }, ctx);
    expect(authed.output).toContain("is authenticated");
  });
});

describe("McpAuth tool: edge cases", () => {
  test("begin on an unknown server is an informational (non-error) message", async () => {
    const ctx = ctxFor({});
    const result = await mcpAuthTool.execute({ server: "ghost", action: "begin" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('Unknown MCP server "ghost"');
  });

  test("begin on a not-configured server is informational", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ plain: { url: mock.mcpUrl } });
    const result = await mcpAuthTool.execute({ server: "plain", action: "begin" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('has no "auth" block');
  });

  test("complete with no flow in progress is informational", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const result = await mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("no authorization is in progress");
  });

  test("timeoutMs is capped at 900000", async () => {
    mock = startMockOAuthServer();
    ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    const mgr = activeManager();
    let observed = 0;
    const spyCtx = makeToolContext({
      mcpAuth: {
        status: (s) => mgr.authStatus(s),
        begin: (s) => mgr.beginAuth(s),
        complete: async (_s, t) => {
          observed = t;
          throw new Error("stop");
        },
      },
    });
    const r = await mcpAuthTool.execute(
      { server: "acme", action: "complete", timeoutMs: 5_000_000 },
      spyCtx,
    );
    expect(observed).toBe(900_000);
    expect(r.isError).toBe(true);
    expect(r.output).toContain("failed: stop");
  });
});

describe("McpAuth tool: manager lifecycle interplay (DH-0091 addServers, lazy reconnect)", () => {
  test("connectAll's eager startup pass (as AgentRuntime runs it) leaves an auth-requiring server needing auth, not stuck failed", async () => {
    // Mirrors AgentRuntime's own construction-time call (runtime.ts's eager, fire-and-forget
    // `this.mcpManager.connectAll()`) — an auth-requiring server has no bearer token yet at
    // that point, so the handshake is rejected, but that must not be indistinguishable from a
    // genuinely broken server: authStatus should still report "needs-auth", and a normal
    // begin/complete flow afterward should work exactly as if connectAll() were never called.
    mock = startMockOAuthServer();
    const ctx = ctxFor({ acme: { url: mock.mcpUrl, auth: {} } });
    await activeManager().connectAll();
    expect(activeManager().authStatus("acme").state).toBe("needs-auth");

    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    const complete = await completeP;
    expect(complete.isError).toBe(false);
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });

  test("a server discovered after construction via addServers is immediately auth-able", async () => {
    mock = startMockOAuthServer();
    // Start with no servers at all (mirrors a `dh.json` with no `mcpServers` block).
    const ctx = ctxFor({});
    const notConfigured = await mcpAuthTool.execute({ server: "acme", action: "status" }, ctx);
    expect(notConfigured.output).toContain("not in the mcpServers config");

    // A project's `.mcp.json` is discovered asynchronously after the tool context is built
    // (DH-0091) — the manager gains the server mid-session, same as the real runtime flow.
    await activeManager().addServers({ acme: { url: mock.mcpUrl, auth: {} } });

    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    expect(begin.isError).toBe(false);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    const complete = await completeP;
    expect(complete.isError).toBe(false);
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });

  test("reconnectFailedServers gives an unauthenticated URL-transport server and a broken command-transport server each a real (failing) retry", async () => {
    mock = startMockOAuthServer();
    const ctx = ctxFor({
      // Never authenticated yet — a bare connect attempt (no bearer token) fails the MCP
      // handshake with "Unauthorized", same as any other unreachable server from
      // `reconnectFailedServers`'s point of view (DH-0002 §6's lazy-retry sweep).
      acme: { url: mock.mcpUrl, auth: {} },
      broken: { command: "/definitely/does/not/exist/mcp-server", args: [] },
    });

    // Neither server has connected yet (both still in their initial `closed` state) — a
    // ToolSearch-driven lazy-retry pass sweeps both, exactly the "never got a first attempt"
    // case the doc comment on `reconnectFailedServers` calls out.
    await activeManager().reconnectFailedServers();

    const { unreachable } = activeManager().listAllTools();
    expect(unreachable.map((u) => u.name).sort()).toEqual(["acme", "broken"]);
    expect(activeManager().authStatus("acme").state).toBe("needs-auth");

    // The manager itself survived reconnecting the mid-flight-unauthenticated server without
    // wedging — a normal begin/complete flow on it still works afterward.
    const begin = await mcpAuthTool.execute({ server: "acme", action: "begin" }, ctx);
    const authUrl = /(https?:\/\/\S+\/authorize\S*)/.exec(begin.output)?.[1] ?? "";
    const completeP = mcpAuthTool.execute({ server: "acme", action: "complete" }, ctx);
    await visit(authUrl);
    const complete = await completeP;
    expect(complete.isError).toBe(false);
    expect(activeManager().authStatus("acme").state).toBe("authenticated");
  });
});
