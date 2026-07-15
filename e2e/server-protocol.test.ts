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

describe("sub-agent spawning over real HTTP/SSE (Round 2, gap 2a)", () => {
  // HANDOFF.md §1's headline product definition is "runs an LLM agent (and any number of
  // sub-agents)" — until this test, that path had zero real-binary e2e coverage (only unit
  // tests in src/agent/runtime.test.ts, which don't cross a process boundary or exercise the
  // real Agent tool -> AnthropicProvider -> mock HTTP round trip). This scripts a genuine
  // tool_use turn calling the Agent tool, and confirms the sub-agent's own SSE events and the
  // nested getAgentTree() shape are real, not a hand-built fixture.
  //
  // Root and sub-agent are wired to *separate* mock provider instances (two models in one
  // dh.json, each pointed at its own mock) rather than sharing one provider's call-order
  // queue. Root's Agent tool call is left at its default `run_in_background: true` — see the
  // comment below on why `false` (blocking) cannot be used here at all in server/interactive
  // mode. With two independent providers there is no shared call-count to race: root's own
  // two turns are strictly ordered by root's provider, and the sub-agent's one turn is
  // strictly ordered by its own.
  test("Agent tool spawns a real sub-agent: SSE events and getAgentTree() show real nesting", async () => {
    const rootProvider = startMockAnthropicProvider([
      {
        toolCalls: [{ name: "Agent", input: { prompt: "Say hi as a sub-agent.", model: "sub" } }],
        stopReason: "tool_use",
      },
      successTurn("Root heard back from the sub-agent."),
    ]);
    cleanups.push(rootProvider.stop);
    const subProvider = startMockAnthropicProvider([successTurn("Sub-agent reporting in.")]);
    cleanups.push(subProvider.stop);

    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig({
      options: { defaultModel: "mock" },
      provider: [
        { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
        { name: "sub-provider", type: "anthropic", baseURL: subProvider.baseURL, apiKey: "k" },
      ],
      models: [
        { name: "mock", provider: "root-provider", model: "mock-model" },
        { name: "sub", provider: "sub-provider", model: "mock-model" },
      ],
    });
    const port = await findFreePort();

    const proc = await spawnDh({ args: ["--server", "--port", String(port)], cwd: ws.dir });
    cleanups.push(proc.kill);
    await proc.waitForStdout(/listening on port/);
    const baseUrl = `http://localhost:${port}`;

    const sse = await connectSse(baseUrl);
    cleanups.push(sse.close);

    const postRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-root",
        message: "spawn a helper",
      }),
    });
    expect(postRes.status).toBe(200);

    // The root's own agent_spawned event first...
    const rootSpawned = await sse.waitFor(
      (e) => e.type === "agent_spawned" && e.agentId === "agent-root",
    );
    expect(rootSpawned).toMatchObject({ parentAgentId: null });

    // ...then a *second* agent_spawned for the sub-agent, with the root as its parent — this
    // is the real signal that a nested agent was actually spawned via the tool, not faked.
    const childSpawned = await sse.waitFor(
      (e) => e.type === "agent_spawned" && e.agentId !== "agent-root",
    );
    expect(childSpawned).toMatchObject({
      type: "agent_spawned",
      parentAgentId: "agent-root",
      model: "sub",
    });
    const childAgentId = (childSpawned as { agentId: string }).agentId;

    // The sub-agent's own output is a real, distinct SSE event carrying its own agentId.
    const childOutput = await sse.waitFor(
      (e) => e.type === "agent_output" && e.agentId === childAgentId,
    );
    expect(childOutput).toMatchObject({ chunk: "Sub-agent reporting in." });

    // Root's own second turn, after the tool_result carrying the sub-agent's output, produces
    // its own further output referencing having heard back.
    const rootOutput = await sse.waitFor(
      (e) => e.type === "agent_output" && e.agentId === "agent-root" && e.chunk.length > 0,
    );
    expect(rootOutput).toMatchObject({ chunk: "Root heard back from the sub-agent." });

    await sse.waitFor(
      (e) => e.type === "agent_status" && e.agentId === "agent-root" && e.status === "waiting",
    );

    expect(rootProvider.callCount).toBe(2);
    expect(subProvider.callCount).toBe(1);

    // getAgentTree() reflects real nesting: one root with one agent-kind child, not a
    // hand-built fixture — this is the first time the wire-level tree shape has been asserted
    // with depth > 1 against the real compiled binary.
    //
    // Previously this test asserted the child's status as "waiting" instead of "done",
    // documenting a real cross-domain bug: AgentRuntime.spawnAgent() was threading
    // `interactive: this.interactive` into sub-agents, so a spawned child never reached
    // "done" even after delivering its final output. Fixed by Core round 7 (commit 2768976);
    // the child now correctly reaches "done".
    const treeRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    const treeBody = (await treeRes.json()) as AgentTreeResponse;
    expect(treeBody.tree).toEqual([
      {
        agentId: "agent-root",
        parentAgentId: null,
        model: "mock",
        status: "waiting",
        children: [
          {
            agentId: childAgentId,
            parentAgentId: "agent-root",
            model: "sub",
            status: "done",
            children: [],
          },
        ],
      },
    ]);

    // The sub-agent's own JSONL log file exists and is addressable independently of the
    // root's — confirming per-agent logging (ADR 0004) actually fires for a spawned child,
    // not just the root.
    const childLogRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "download_logs", agentId: childAgentId }),
    });
    expect(childLogRes.status).toBe(200);
    const childJsonl = await childLogRes.text();
    const childFirstLine = JSON.parse(childJsonl.split("\n")[0] ?? "{}");
    expect(childFirstLine).toMatchObject({
      type: "header",
      agentId: childAgentId,
      parentAgentId: "agent-root",
    });
  }, 15_000);
});
