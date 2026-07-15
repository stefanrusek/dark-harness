// Security matrix (ADR 0004, docs/handoffs/e2e.md scope item 6): unauthenticated rejection
// (POST and SSE), authenticated happy path, and a self-signed-cert TLS round trip — driven
// against the real compiled `dh --server` process, never in-process.

import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { AgentTreeResponse, SecurityConfig } from "../src/contracts/index.ts";
import { REPO_ROOT } from "./support/build.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

const TEST_CERT = resolve(REPO_ROOT, "src/server/testdata/test-cert.pem");
const TEST_KEY = resolve(REPO_ROOT, "src/server/testdata/test-key.pem");
const TOKEN = "s3cret-test-token";

async function startSecuredServer(security: SecurityConfig) {
  const provider = startMockAnthropicProvider([successTurn("Secured hello.")]);
  cleanups.addProcess(provider.stop);
  const ws = createWorkspace();
  cleanups.addWorkspace(ws.cleanup);
  ws.writeConfig(baseConfig(provider.baseURL, { security }));
  const { proc, port } = await startDhServer({ cwd: ws.dir });
  cleanups.addProcess(proc.kill);
  return port;
}

describe("security matrix", () => {
  test("bearer token: unauthenticated POST is rejected with 401", async () => {
    const port = await startSecuredServer({ token: TOKEN });
    const res = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    expect(res.status).toBe(401);
  });

  test("bearer token: unauthenticated SSE connection is rejected with 401", async () => {
    const port = await startSecuredServer({ token: TOKEN });
    const sse = await connectSse(`http://localhost:${port}`);
    expect((sse as unknown as { status: number }).status).toBe(401);
  });

  test("bearer token: wrong token is rejected with 401", async () => {
    const port = await startSecuredServer({ token: TOKEN });
    const res = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    expect(res.status).toBe(401);
  });

  test("bearer token: authenticated happy path (POST and SSE both succeed)", async () => {
    const port = await startSecuredServer({ token: TOKEN });
    const baseUrl = `http://localhost:${port}`;

    const treeRes = await fetch(`${baseUrl}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    expect(treeRes.status).toBe(200);
    const body = (await treeRes.json()) as AgentTreeResponse;
    expect(body.ok).toBe(true);

    const sse = await connectSse(baseUrl, { token: TOKEN });
    cleanups.addProcess(sse.close);
    expect((sse as unknown as { status?: number }).status ?? 200).toBe(200);

    await fetch(`${baseUrl}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
    });
    const ended = await sse.waitFor((e) => e.type === "session_ended");
    expect(ended).toMatchObject({ exitCode: 0 });
  });

  test("TLS: self-signed cert round trip over https://", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello over TLS.")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(
      baseConfig(provider.baseURL, {
        security: { tls: { cert: TEST_CERT, key: TEST_KEY } },
      }),
    );
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);

    const res = await fetch(`https://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentTreeResponse;
    expect(body.ok).toBe(true);

    // Plain http:// against the same port must not work — it's genuinely HTTPS-only now.
    let plainHttpFailed = false;
    try {
      await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "request_agent_tree" }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      plainHttpFailed = true;
    }
    expect(plainHttpFailed).toBe(true);
  });

  test("TLS + bearer token together: both protections apply independently", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello over TLS+token.")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(
      baseConfig(provider.baseURL, {
        security: { token: TOKEN, tls: { cert: TEST_CERT, key: TEST_KEY } },
      }),
    );
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);

    const unauthed = await fetch(`https://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    expect(unauthed.status).toBe(401);

    const authed = await fetch(`https://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: "request_agent_tree" }),
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    expect(authed.status).toBe(200);
  });
});
