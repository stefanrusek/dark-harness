// Real client<->server over HTTP/SSE across an actual process boundary (docs/handoffs/e2e.md
// scope item 5): spawns the real compiled `dh --server` as its own OS process and drives it
// with a plain `fetch`-based test client — not Server's own in-process integration tests
// (src/server/server.test.ts), which never cross a real process boundary at all.

import { afterEach, describe, expect, test } from "bun:test";
import { ExitCode } from "../src/contracts/exit-codes.ts";
import type { AgentTreeResponse, CommandAck } from "../src/contracts/index.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

async function startServer() {
  const provider = startMockAnthropicProvider([successTurn("Server protocol says hi.")]);
  cleanups.addProcess(provider.stop);
  const ws = createWorkspace();
  cleanups.addWorkspace(ws.cleanup);
  ws.writeConfig(baseConfig(provider.baseURL));
  const { proc, port } = await startDhServer({ cwd: ws.dir });
  cleanups.addProcess(proc.kill);

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
    cleanups.addProcess(sse.close);

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
    // DH-0059: stopping an agent paused "waiting" for its next message is a graceful end of
    // the conversation, not an interrupted task — exitCode 0, not 1 (ADR 0006 amendment).
    expect(ended).toMatchObject({ type: "session_ended", exitCode: ExitCode.Success });
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
    cleanups.addProcess(resumed.close);
    const replayedStatus = await resumed.waitFor(
      (e) => e.type === "agent_status" && e.status === "waiting",
    );
    expect(replayedStatus.id).toBe(status.id);
  });

  test("a second send_message to a waiting root agent continues the same conversation", async () => {
    // Open thread since Round 1/2 (docs/roster/hedy.md): every prior sub-agent e2e test
    // incidentally drove two exchanges as a side effect of testing spawning, but nothing
    // asserted the actual point of plain multi-turn continuity — a *second* send_message to
    // an already-"waiting" root agent, with no sub-agents involved, over real HTTP/SSE.
    const provider = startMockAnthropicProvider([
      successTurn("Nice to meet you, Ada."),
      successTurn("Yes, I remember your name is Ada."),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);
    const baseUrl = `http://localhost:${port}`;

    const sse = await connectSse(baseUrl);
    cleanups.addProcess(sse.close);

    // First exchange.
    const firstRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-root",
        message: "Hi, my name is Ada.",
      }),
    });
    expect(firstRes.status).toBe(200);

    const firstOutput = await sse.waitFor(
      (e) => e.type === "agent_output" && e.agentId === "agent-root" && e.chunk.length > 0,
    );
    expect(firstOutput).toMatchObject({ chunk: "Nice to meet you, Ada." });

    const isWaiting = (e: (typeof sse.events)[number]) =>
      e.type === "agent_status" && e.agentId === "agent-root" && e.status === "waiting";
    await sse.waitFor(isWaiting);
    expect(provider.callCount).toBe(1);

    // Second exchange, sent only after the first has fully completed and the session is
    // sitting "waiting" — this is the actual scenario this test exists to prove.
    const secondRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-root",
        message: "What is my name?",
      }),
    });
    expect(secondRes.status).toBe(200);

    const secondOutput = await sse.waitFor(
      (e) =>
        e.type === "agent_output" &&
        e.agentId === "agent-root" &&
        e.chunk === "Yes, I remember your name is Ada.",
    );
    expect(secondOutput).toMatchObject({ chunk: "Yes, I remember your name is Ada." });

    await sse.waitFor((e) => isWaiting(e) && sse.events.filter(isWaiting).length >= 2);
    expect(provider.callCount).toBe(2);

    // The real proof of shared conversation history, not two independent runs: the second
    // /v1/messages request the mock provider actually received carries the *entire* prior
    // exchange (both the user's first message and the model's first reply) ahead of the new
    // user turn — a fresh/independent session would only ever send the second message alone.
    const secondRequest = provider.requests[1] as {
      messages: { role: string; content: unknown }[];
    };
    const roles = secondRequest.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    const flatten = (content: unknown): string =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c: { text?: string }) => c.text ?? "").join("")
          : "";
    expect(flatten(secondRequest.messages[0]?.content)).toContain("Hi, my name is Ada.");
    expect(flatten(secondRequest.messages[1]?.content)).toContain("Nice to meet you, Ada.");
    expect(flatten(secondRequest.messages[2]?.content)).toContain("What is my name?");
  });

  test("download_logs: per-agent JSONL and full session tar bundle", async () => {
    const { baseUrl } = await startServer();

    await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
    });
    const sse = await connectSse(baseUrl);
    cleanups.addProcess(sse.close);
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
        toolCalls: [
          {
            name: "Agent",
            input: {
              prompt: "Say hi as a sub-agent.",
              description: "Say hi as sub-agent",
              model: "sub",
            },
          },
        ],
        stopReason: "tool_use",
      },
      successTurn("Root heard back from the sub-agent."),
    ]);
    cleanups.addProcess(rootProvider.stop);
    const subProvider = startMockAnthropicProvider([successTurn("Sub-agent reporting in.")]);
    cleanups.addProcess(subProvider.stop);

    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
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
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);
    const baseUrl = `http://localhost:${port}`;

    const sse = await connectSse(baseUrl);
    cleanups.addProcess(sse.close);

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

    // Three calls, not two: root's own tool_use turn (1) and its "heard back" turn (2), plus
    // a third triggered by Core round 12's proactive wake-up (commit b9384f2) — once the
    // sub-agent finishes, the parent agent is woken for an extra turn to process the
    // completion push notification, sending root back to "running" and then "waiting" again.
    // That wake-up happens asynchronously *after* root's first "waiting" status (from turn 2),
    // so wait for the *second* "waiting" status rather than asserting immediately.
    const isRootWaiting = (e: (typeof sse.events)[number]) =>
      e.type === "agent_status" && e.agentId === "agent-root" && e.status === "waiting";
    await sse.waitFor((e) => isRootWaiting(e) && sse.events.filter(isRootWaiting).length >= 2);

    expect(rootProvider.callCount).toBe(3);
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
            // DH-0069: description is now required for any spawned sub-agent (this mock turn
            // supplies "Say hi as sub-agent" — see the Agent tool_use input above).
            description: "Say hi as sub-agent",
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
