// Real client<->server over HTTP/SSE across an actual process boundary (docs/handoffs/e2e.md
// scope item 5): spawns the real compiled `dh --server` as its own OS process and drives it
// with a plain `fetch`-based test client — not Server's own in-process integration tests
// (src/server/server.test.ts), which never cross a real process boundary at all.

import { afterEach, describe, expect, test } from "bun:test";
import { ExitCode } from "../src/contracts/exit-codes.ts";
import type { AgentTreeResponse, CommandAck } from "../src/contracts/index.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { findFreePort } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function startServer() {
  const provider = startMockAnthropicProvider([successTurn("Server protocol says hi.")]);
  cleanups.push(provider.stop);
  const ws = createWorkspace();
  cleanups.push(ws.cleanup);
  ws.writeConfig(baseConfig(provider.baseURL));
  const port = await findFreePort();

  const proc = await spawnDh({ args: ["--server", "--port", String(port)], cwd: ws.dir });
  cleanups.push(proc.kill);
  await proc.waitForStdout(/listening on port/);

  return { baseUrl: `http://localhost:${port}`, proc, provider };
}

describe("real client <-> server over HTTP/SSE (separate processes)", () => {
  test("request_agent_tree returns a root node before any message is sent", async () => {
    const { baseUrl } = await startServer();

    const res = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    const body = (await res.json()) as AgentTreeResponse;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tree).toEqual([
      {
        agentId: "agent-root",
        parentAgentId: null,
        model: "mock",
        status: "waiting",
        children: [],
      },
    ]);
  });

  test("send_message to an unknown agentId is rejected with 404", async () => {
    const { baseUrl } = await startServer();

    const res = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-does-not-exist",
        message: "hi",
      }),
    });
    const body = (await res.json()) as CommandAck;

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  test("send_message to agent-root runs a full turn, observable live over SSE", async () => {
    const { baseUrl, provider } = await startServer();

    const sse = await connectSse(baseUrl);
    cleanups.push(sse.close);

    const postRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hello there" }),
    });
    expect(postRes.status).toBe(200);

    const spawned = await sse.waitFor((e) => e.type === "agent_spawned");
    expect(spawned).toMatchObject({
      type: "agent_spawned",
      agentId: "agent-root",
      parentAgentId: null,
    });

    const output = await sse.waitFor((e) => e.type === "agent_output");
    expect(output).toMatchObject({
      type: "agent_output",
      agentId: "agent-root",
      chunk: "Server protocol says hi.",
    });

    const tokenUsage = await sse.waitFor((e) => e.type === "token_usage");
    expect(tokenUsage).toMatchObject({ type: "token_usage", agentId: "agent-root" });

    // Round 5: a non-tool-call turn in an interactive session now pauses "waiting" for the
    // next message rather than ending the session — there is no natural "done"/session_ended
    // after a single exchange anymore (docs/handoffs/core.md Round 5).
    const status = await sse.waitFor((e) => e.type === "agent_status");
    expect(status).toMatchObject({
      type: "agent_status",
      agentId: "agent-root",
      status: "waiting",
    });

    expect(provider.callCount).toBe(1);

    // Tree reflects the paused-waiting run — not "done".
    const treeRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    const treeBody = (await treeRes.json()) as AgentTreeResponse;
    expect(treeBody.tree[0]?.status).toBe("waiting");

    // To actually observe a session_ended/exit code for an interactive session, a genuine stop
    // is required (Round 3's "stopped collapses into failed" convention) — mirrors the fix
    // src/cli.test.ts's Round 5 update made for the identical assumption.
    const stopRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "stop_agent", agentId: "agent-root" }),
    });
    expect(stopRes.status).toBe(200);

    const ended = await sse.waitFor((e) => e.type === "session_ended");
    expect(ended).toMatchObject({ type: "session_ended", exitCode: ExitCode.TaskFailure });
  });

  test("SSE resume via Last-Event-ID replays buffered events", async () => {
    const { baseUrl } = await startServer();

    await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
    });

    const first = await connectSse(baseUrl);
    // Round 5: a single message now pauses the interactive session "waiting" rather than
    // ending it — use that status change (a turn having completed) as the synchronization
    // point instead of session_ended, which no longer fires here.
    const status = await first.waitFor((e) => e.type === "agent_status" && e.status === "waiting");
    first.close();

    // A fresh connection with Last-Event-ID set to the very first event's id should replay
    // everything after it, including the same agent_status event we already saw.
    const firstEventId = first.events[0]?.id;
    expect(firstEventId).toBeDefined();
    const resumed = await connectSse(baseUrl, { lastEventId: firstEventId as string });
    cleanups.push(resumed.close);
    const replayedStatus = await resumed.waitFor(
      (e) => e.type === "agent_status" && e.status === "waiting",
    );
    expect(replayedStatus.id).toBe(status.id);
  });

  test("download_logs: per-agent JSONL and full session tar bundle", async () => {
    const { baseUrl } = await startServer();

    await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
    });
    const sse = await connectSse(baseUrl);
    cleanups.push(sse.close);
    // Round 5: wait for the turn to complete ("waiting" for the next message) rather than
    // session_ended, which no longer fires after a single exchange in an interactive session.
    await sse.waitFor((e) => e.type === "agent_status" && e.status === "waiting");

    const agentLogRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "download_logs", agentId: "agent-root" }),
    });
    expect(agentLogRes.status).toBe(200);
    expect(agentLogRes.headers.get("content-type")).toBe("application/x-ndjson");
    const jsonl = await agentLogRes.text();
    const firstLine = JSON.parse(jsonl.split("\n")[0] ?? "{}");
    expect(firstLine).toMatchObject({ type: "header", agentId: "agent-root", parentAgentId: null });

    const bundleRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "download_logs" }),
    });
    expect(bundleRes.status).toBe(200);
    expect(bundleRes.headers.get("content-type")).toBe("application/x-tar");
    const tarBytes = new Uint8Array(await bundleRes.arrayBuffer());
    expect(tarBytes.length).toBeGreaterThan(0);
  });
});
