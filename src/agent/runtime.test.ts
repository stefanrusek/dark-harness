// Integration tests for AgentRuntime — the composition root that wires dh.json config,
// provider adapters, the tool set, and the task registry together (docs/handoffs/core.md §4).
//
// These deliberately exercise the real AnthropicProvider (not a stubbed ModelProvider)
// against a local mock Anthropic-compatible HTTP server, since createProvider() always
// builds a real adapter from config — the same "local provider" path the sample dh.json
// documents (custom baseURL). This gives real end-to-end coverage of config -> provider ->
// loop -> tool dispatch without ever touching the network.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import {
  type AgentTreeNode,
  type DhConfig,
  ExitCode,
  type LogLine,
  type ServerSentEvent,
} from "../contracts/index.ts";
import { AgentRuntime, ConfigModelError, ROOT_AGENT_ID, RootNotListeningError } from "./runtime.ts";
import { bashTool } from "./tools/bash.ts";

/** A minimal Anthropic Messages API-shaped mock server. Decides its response from the last
 * message's content, independent of call ordering, so it stays correct under the
 * concurrent sub-agent scenarios this suite exercises. */
function startMockAnthropicServer() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as {
        messages: { role: string; content: { type: string; text?: string }[] }[];
      };
      const lastMessage = body.messages[body.messages.length - 1];
      const content = lastMessage?.content ?? [];
      const text = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      const hasToolResult = content.some((c) => c.type === "tool_result");
      const firstMessage = body.messages[0];
      const firstText = (firstMessage?.content ?? [])
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");

      const message = (contentBlocks: unknown[], stopReason: string): Response =>
        Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: contentBlocks,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 5 },
        });

      // Round 6c test support: keeps calling a tool forever, regardless of tool_result
      // feedback, so the maxTurns safety valve is the only thing that can end the run —
      // used to prove options.maxTurns actually threads from config into the loop.
      if (firstText.includes("loop-forever")) {
        return message(
          [
            {
              type: "tool_use",
              id: "tu_loop",
              name: "Bash",
              input: { command: "true", run_in_background: false },
            },
          ],
          "tool_use",
        );
      }

      if (!hasToolResult) {
        if (text.includes("use-agent-tool")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_agent",
                name: "Agent",
                input: { prompt: "child instruction", run_in_background: false },
              },
            ],
            "tool_use",
          );
        }
        if (text.includes("use-skill-tool")) {
          return message(
            [{ type: "tool_use", id: "tu_skill", name: "Skill", input: { skill: "nope" } }],
            "tool_use",
          );
        }
        if (text.includes("use-toolsearch")) {
          return message(
            [{ type: "tool_use", id: "tu_search", name: "ToolSearch", input: { query: "q" } }],
            "tool_use",
          );
        }
        if (text.includes("use-bash-pwd")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_bash",
                name: "Bash",
                input: { command: "pwd", run_in_background: false },
              },
            ],
            "tool_use",
          );
        }
        if (text.includes("use-unknown-tool")) {
          return message(
            [{ type: "tool_use", id: "tu_unknown", name: "Read", input: {} }],
            "tool_use",
          );
        }
        if (text === "child instruction") {
          return message([{ type: "text", text: "child done" }], "end_turn");
        }
        if (text.includes("fail please")) {
          return message([{ type: "text", text: "could not do it TASK_FAILED" }], "end_turn");
        }
        return message([{ type: "text", text: "root done" }], "end_turn");
      }

      return message([{ type: "text", text: "finished after tool" }], "end_turn");
    },
  });
}

let server: ReturnType<typeof startMockAnthropicServer>;

beforeAll(() => {
  server = startMockAnthropicServer();
});

afterAll(() => {
  server.stop(true);
});

function baseConfig(overrides: Partial<DhConfig> = {}): DhConfig {
  return {
    options: { defaultModel: "test-model" },
    models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
    provider: [
      { name: "mock", type: "anthropic", baseURL: server.url.toString(), apiKey: "sk-test" },
    ],
    ...overrides,
  };
}

function collectors() {
  const events: ServerSentEvent[] = [];
  const logLines: LogLine[] = [];
  const loggedAgentIds: string[] = [];
  return {
    events,
    logLines,
    loggedAgentIds,
    onEvent: (e: ServerSentEvent) => events.push(e),
    onLogLine: (agentId: string, l: LogLine) => {
      loggedAgentIds.push(agentId);
      logLines.push(l);
    },
  };
}

describe("AgentRuntime", () => {
  test("runRoot runs the default model end-to-end against the mock provider", async () => {
    const { events, logLines, loggedAgentIds, onEvent, onLogLine } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "you are a test agent",
      onEvent,
      onLogLine,
    });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("root done");
    expect(events.some((e) => e.type === "agent_spawned" && e.agentId === "agent-root")).toBe(true);
    expect(logLines[0]?.type).toBe("header");
    // onLogLine's agentId param (a Round 2 addition) is threaded correctly for the root.
    expect(loggedAgentIds.every((id) => id === ROOT_AGENT_ID)).toBe(true);
    expect(loggedAgentIds.length).toBeGreaterThan(0);
    // Cross-domain contract: Server's waitForExitCode (src/server/exit.ts on main)
    // subscribes to this event to resolve --job's exit code.
    const sessionEnded = events.find((e) => e.type === "session_ended");
    expect(sessionEnded).toMatchObject({ type: "session_ended", exitCode: ExitCode.Success });
  });

  test("runRoot emits session_ended with TaskFailure when the root agent self-reports failure", async () => {
    const { events, onEvent } = collectors();
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    const result = await runtime.runRoot("fail please");
    expect(result.success).toBe(false);
    const sessionEnded = events.find((e) => e.type === "session_ended");
    expect(sessionEnded).toMatchObject({ type: "session_ended", exitCode: ExitCode.TaskFailure });
  });

  test("runRoot accepts an explicit model name overriding options.defaultModel", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig({
        models: [
          { name: "test-model", provider: "mock", model: "mock-1" },
          { name: "other-model", provider: "mock", model: "mock-2" },
        ],
      }),
      systemPrompt: "you are a test agent",
    });
    const result = await runtime.runRoot("please just answer", "other-model");
    expect(result.success).toBe(true);
  });

  test("runRoot works without onEvent/onLogLine callbacks", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "you are a test agent",
    });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
  });

  test("sessionId defaults to a generated id when not provided", () => {
    const a = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const b = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionId.length).toBeGreaterThan(0);
  });

  test("sessionId honors an explicit override", () => {
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      sessionId: "session-fixed",
    });
    expect(runtime.sessionId).toBe("session-fixed");
  });

  test("spawnAgent starts a task that reaches 'done' and carries the sub-agent's output", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const taskId = runtime.spawnAgent("agent-root", {
      model: "test-model",
      prompt: "child instruction",
    });
    await runtime.tasks.awaitDone(taskId);
    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.status).toBe("done");
    expect(snapshot.output).toContain("child done");
  });

  test("spawnAgent surfaces a sub-agent's self-reported TASK_FAILED as a failed task", async () => {
    const { onEvent, onLogLine } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      onEvent,
      onLogLine,
    });
    const taskId = runtime.spawnAgent("agent-root", { model: "test-model", prompt: "fail please" });
    await runtime.tasks.awaitDone(taskId);
    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.status).toBe("failed");
    expect(snapshot.error).toContain("TASK_FAILED");
  });

  test("spawnAgent's returned task id IS the sub-agent's own SSE/log agentId (unified identifier space)", async () => {
    const { events, loggedAgentIds, onEvent, onLogLine } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      onEvent,
      onLogLine,
    });
    const taskId = runtime.spawnAgent("agent-root", {
      model: "test-model",
      prompt: "child instruction",
    });
    await runtime.tasks.awaitDone(taskId);
    // Every event/log line this sub-agent produced carries `taskId` as its own agentId —
    // not a different loop-internal id requiring translation.
    const subAgentEvents = events.filter((e) => "agentId" in e && e.agentId === taskId);
    expect(subAgentEvents.length).toBeGreaterThan(0);
    expect(loggedAgentIds.filter((id) => id === taskId).length).toBeGreaterThan(0);
    expect(runtime.tasks.snapshot(taskId).id).toBe(taskId);
  });

  test("spawnAgent throws ConfigModelError for an unknown model name", () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(() => runtime.spawnAgent("agent-root", { model: "nope", prompt: "x" })).toThrow(
      ConfigModelError,
    );
  });

  test("runRoot rejects when the resolved model references an unknown provider", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig({
        provider: [{ name: "someone-else", type: "anthropic" }],
      }),
      systemPrompt: "sp",
    });
    await expect(runtime.runRoot("please just answer")).rejects.toThrow(ConfigModelError);
  });

  test("providerFor caches and reuses the same provider instance across calls", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const first = await runtime.runRoot("please just answer");
    const second = await runtime.runRoot("please just answer");
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  test("buildToolContext wires spawnAgent so the Agent tool can block on a sub-agent", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const result = await runtime.runRoot("use-agent-tool");
    expect(result.success).toBe(true);
  });

  test("buildToolContext wires loadSkill so the Skill tool can look it up", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig({ skillPaths: ["/nonexistent"] }),
      systemPrompt: "sp",
    });
    const result = await runtime.runRoot("use-skill-tool");
    // The skill isn't found (no such path) but the wiring itself must not throw — the
    // Bash-style tool_result error is fed back and the loop still completes.
    expect(result.success).toBe(true);
  });

  test("buildToolContext wires searchDeferredTools so the ToolSearch tool can query it", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig({ mcpServers: { docs: { url: "https://example.com" } } }),
      systemPrompt: "sp",
    });
    const result = await runtime.runRoot("use-toolsearch");
    expect(result.success).toBe(true);
  });

  test("buildToolContext defaults cwd to process.cwd() when not overridden", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const result = await runtime.runRoot("use-bash-pwd");
    expect(result.success).toBe(true);
    const toolResult = logLines.find((l) => l.type === "tool_result");
    const output = toolResult && toolResult.type === "tool_result" ? toolResult.output : "";
    expect(typeof output === "string" ? output.trim() : "").toBe(process.cwd());
  });

  test("buildToolContext honors an explicit cwd override", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      cwd: "/tmp",
      onLogLine,
    });
    const result = await runtime.runRoot("use-bash-pwd");
    expect(result.success).toBe(true);
    const toolResult = logLines.find((l) => l.type === "tool_result");
    const output = toolResult && toolResult.type === "tool_result" ? toolResult.output : "";
    // Compare via realpath: on macOS, /tmp is a symlink to /private/tmp, and a shell's
    // `pwd` (no -L) resolves to the physical path, so the literal "/tmp" would not match.
    expect(typeof output === "string" ? output.trim() : "").toBe(realpathSync("/tmp"));
  });

  test("an explicit tools option restricts the tool map away from ALL_TOOLS", async () => {
    const runtime = new AgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      tools: [bashTool],
    });
    const result = await runtime.runRoot("use-unknown-tool");
    expect(result.success).toBe(true);
  });
});

describe("AgentRuntime.rootHasStarted / getAgentTree / sendMessageToRoot (Round 2)", () => {
  test("rootHasStarted is false before runRoot() and true after", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(runtime.rootHasStarted).toBe(false);
    await runtime.runRoot("please just answer");
    expect(runtime.rootHasStarted).toBe(true);
  });

  test("getAgentTree() includes a 'waiting' root node before the root agent has started", () => {
    // Round 2 correction (found via a live integration test against a real DhServer): an
    // empty tree pre-start makes the root unreachable by Server's own send_message
    // validation (src/server/commands.ts's findAgent check runs before AgentLoopHandle.
    // sendMessage() is ever called) — see runtime.ts's rootStatus field doc comment.
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(runtime.getAgentTree()).toEqual([
      {
        agentId: ROOT_AGENT_ID,
        parentAgentId: null,
        model: "test-model",
        status: "waiting",
        children: [],
      },
    ]);
  });

  test("getAgentTree() returns a lone root node once runRoot() completes, with no sub-agents", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await runtime.runRoot("please just answer");
    const tree = runtime.getAgentTree();
    expect(tree).toEqual([
      {
        agentId: ROOT_AGENT_ID,
        parentAgentId: null,
        model: "test-model",
        status: "done",
        children: [],
      },
    ]);
  });

  test("getAgentTree() reflects 'failed' root status after a self-reported failure", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await runtime.runRoot("fail please");
    expect(runtime.getAgentTree()[0]?.status).toBe("failed");
  });

  test("getAgentTree() nests agent-kind sub-agents under their parent, excluding bash-kind tasks", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    // A bash-kind task, spawned directly against the registry (as the Bash tool would for a
    // run_in_background call) — must NOT appear in the tree (Round 2 judgment call: the
    // tree is agent-kind only).
    runtime.tasks.start({ kind: "bash", parentAgentId: ROOT_AGENT_ID, run: async () => {} });
    const childTaskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
    });
    await runtime.tasks.awaitDone(childTaskId);
    // The tree reflects the task registry's current state regardless of whether runRoot()
    // has been called yet — the root node's own status ("waiting" here) is independent of
    // its children's. (This ordering — spawning a "sub-agent" before the root has run — is
    // artificial, purely to isolate the bash-vs-agent filtering in one test; in production
    // only a running root's own tool calls can spawn a sub-agent at all.)
    const expectedChild: AgentTreeNode = {
      agentId: childTaskId,
      parentAgentId: ROOT_AGENT_ID,
      model: "test-model",
      status: "done",
      children: [],
    };
    expect(runtime.getAgentTree()).toEqual([
      {
        agentId: ROOT_AGENT_ID,
        parentAgentId: null,
        model: "test-model",
        status: "waiting",
        children: [expectedChild],
      },
    ]);
    await runtime.runRoot("please just answer");
    const tree = runtime.getAgentTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]?.status).toBe("done");
    expect(tree[0]?.children).toEqual([expectedChild]);
  });

  test("sendMessageToRoot throws RootNotListeningError before the root agent has started", () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(() => runtime.sendMessageToRoot("hi")).toThrow(RootNotListeningError);
  });

  test("sendMessageToRoot delivers into the running root agent's next turn", async () => {
    // A dedicated local mock server (not the shared one above) so this test can capture and
    // assert on raw request bodies without disturbing the other tests' shared fixture.
    const requestBodies: unknown[] = [];
    const dedicatedServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        requestBodies.push(body);
        const isFirstCall = requestBodies.length === 1;
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: isFirstCall
            ? [
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "Bash",
                  input: { command: "echo hi", run_in_background: false },
                },
              ]
            : [{ type: "text", text: "done" }],
          stop_reason: isFirstCall ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    try {
      const runtime = new AgentRuntime({
        config: baseConfig({
          provider: [
            {
              name: "mock",
              type: "anthropic",
              baseURL: dedicatedServer.url.toString(),
              apiKey: "sk-test",
            },
          ],
        }),
        systemPrompt: "sp",
      });
      const rootPromise = runtime.runRoot("use-bash-pwd");
      // runAgentLoop registers its sendMessage sink synchronously at the top of the call
      // (before its first `await provider.complete(...)` resolves), so this is safe to call
      // right away — it lands in `pendingMessages` in time for turn 2's request.
      runtime.sendMessageToRoot("steer this way");
      const result = await rootPromise;
      expect(result.success).toBe(true);
      expect(requestBodies.length).toBe(2);
      const secondRequest = requestBodies[1] as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const sawInjected = secondRequest.messages.some((m) =>
        m.content.some((c) => c.type === "text" && c.text?.includes("steer this way")),
      );
      expect(sawInjected).toBe(true);
    } finally {
      dedicatedServer.stop(true);
    }
  });
});

describe("AgentRuntime.stopRoot / spawnAgent signal threading (Round 3: real cancellation)", () => {
  /** A mock provider endpoint that never resolves its response on its own — the only way
   * runRoot()/spawnAgent() below can finish is if the AbortSignal genuinely propagates all
   * the way down to the outbound fetch call. If it didn't, these tests would hang until
   * bun's default per-test timeout and fail — that failure mode *is* the test. */
  function startNeverRespondingServer() {
    return Bun.serve({
      port: 0,
      fetch() {
        return new Promise<Response>(() => {
          // Deliberately never resolves.
        });
      },
    });
  }

  test("stopRoot() aborts a running root loop's in-flight provider call", async () => {
    const slowServer = startNeverRespondingServer();
    try {
      const config: DhConfig = {
        options: { defaultModel: "test-model" },
        models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
        provider: [
          {
            name: "mock",
            type: "anthropic",
            baseURL: slowServer.url.toString(),
            apiKey: "sk-test",
          },
        ],
      };
      const { events, onEvent } = collectors();
      const runtime = new AgentRuntime({ config, systemPrompt: "sp", onEvent });
      const rootPromise = runtime.runRoot("go");
      // Give the fetch a moment to actually be in flight before stopping it.
      await new Promise((resolve) => setTimeout(resolve, 20));
      runtime.stopRoot();
      const result = await rootPromise;
      expect(result.success).toBe(false);
      const statusEvent = events.find((e) => e.type === "agent_status");
      expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe(
        "failed",
      );
    } finally {
      slowServer.stop(true);
    }
  });

  test("stopRoot() before runRoot() has ever been called is a safe no-op", () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(() => runtime.stopRoot()).not.toThrow();
  });

  test("stopRoot() after the root has already finished is a safe no-op", async () => {
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await runtime.runRoot("please just answer");
    expect(() => runtime.stopRoot()).not.toThrow();
  });

  test("tasks.stop(subAgentId) aborts a sub-agent's in-flight provider call, not just its bookkeeping", async () => {
    const slowServer = startNeverRespondingServer();
    try {
      const config: DhConfig = {
        options: { defaultModel: "test-model" },
        models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
        provider: [
          {
            name: "mock",
            type: "anthropic",
            baseURL: slowServer.url.toString(),
            apiKey: "sk-test",
          },
        ],
      };
      const runtime = new AgentRuntime({ config, systemPrompt: "sp" });
      const taskId = runtime.spawnAgent(ROOT_AGENT_ID, { model: "test-model", prompt: "go" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      runtime.tasks.stop(taskId);
      await runtime.tasks.awaitDone(taskId);
      // Before Round 3, tasks.stop() only ever updated registry bookkeeping — the loop
      // itself kept running (and the fetch kept hanging) regardless. awaitDone() resolving
      // at all here (rather than this test timing out) is the actual proof of the fix; the
      // status assertion below is a secondary sanity check.
      expect(runtime.tasks.snapshot(taskId).status).toBe("failed");
    } finally {
      slowServer.stop(true);
    }
  });
});

describe("AgentRuntime.runRoot — Round 4: rootStatus/getAgentTree must not get stuck 'running' on a crash", () => {
  /** Mimics the real bug the coordinator found by hand: a bad apiKey/unreachable endpoint
   * makes the real provider adapter's SDK call throw before runAgentLoop ever produces a
   * self-report — a genuine rejection, not the Round 3 abort-triggered one loop.ts treats as
   * a clean stop. A 401 response is what a real Anthropic-shaped endpoint returns for a bad
   * apiKey; the SDK throws on it, AnthropicProvider wraps it in ProviderError, and nothing
   * before Round 4 ever updated `this.rootStatus` on that path. */
  function startUnauthorizedServer() {
    return Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      },
    });
  }

  function crashingConfig(server: ReturnType<typeof startUnauthorizedServer>): DhConfig {
    return {
      options: { defaultModel: "test-model" },
      models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
      provider: [
        { name: "mock", type: "anthropic", baseURL: server.url.toString(), apiKey: "sk-bad" },
      ],
    };
  }

  test("runRoot() rejects, but rootStatus/getAgentTree() report 'failed' immediately afterward — not stuck 'running'", async () => {
    const server = startUnauthorizedServer();
    try {
      const runtime = new AgentRuntime({ config: crashingConfig(server), systemPrompt: "sp" });
      await expect(runtime.runRoot("go")).rejects.toThrow();
      // The actual regression check: polled *after* the throw has already been handled by
      // the caller (this test), exactly like a fresh request_agent_tree from a client that
      // connects after the crash — not observed via any transient event.
      const tree = runtime.getAgentTree();
      expect(tree[0]?.status).toBe("failed");
    } finally {
      server.stop(true);
    }
  });

  test("runRoot()'s crash path fires a session_ended event, matching the normal-completion path's contract", async () => {
    const server = startUnauthorizedServer();
    try {
      const events: ServerSentEvent[] = [];
      const runtime = new AgentRuntime({
        config: crashingConfig(server),
        systemPrompt: "sp",
        onEvent: (e) => events.push(e),
      });
      await expect(runtime.runRoot("go")).rejects.toThrow();
      const sessionEnded = events.find((e) => e.type === "session_ended");
      expect(sessionEnded).toMatchObject({
        type: "session_ended",
        exitCode: ExitCode.HarnessError,
      });
    } finally {
      server.stop(true);
    }
  });

  test("polling getAgentTree() repeatedly after a crash never reports 'running' again (no delayed/stale update)", async () => {
    const server = startUnauthorizedServer();
    try {
      const runtime = new AgentRuntime({ config: crashingConfig(server), systemPrompt: "sp" });
      await expect(runtime.runRoot("go")).rejects.toThrow();
      // Mirrors the coordinator's manual repro: poll several times with real delays between
      // calls, the way an operator's client actually would, rather than checking once.
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(runtime.getAgentTree()[0]?.status).toBe("failed");
      }
    } finally {
      server.stop(true);
    }
  });
});

// Round 5 (docs/handoffs/core.md status log): confirmed live by the owner and coordinator
// against a real LM Studio instance — a root (and, by the same code path, any sub-agent)
// could only ever receive ONE message. A second send_message returned {"ok":true} but did
// nothing: no new turn, no output, status stuck "done" forever. Root cause: loop.ts treated
// any non-tool-use turn as terminal, which is right for the standalone `--instructions`/
// `--job` path but wrong for an interactive conversation. This describe block proves the
// fix for both the root and a sub-agent: a real second exchange, with message history
// preserved (the mock provider below echoes back the exact concatenated text of every user
// message it has ever seen for a given "conversation" key, so a correct third-message reply
// containing all three original texts is only possible if the loop is actually accumulating
// history across exchanges, not starting fresh each time).
describe("AgentRuntime — Round 5: an interactive session survives more than one exchange", () => {
  /** Doesn't just echo the last message — accumulates and echoes *every* user text it has
   * ever seen, across calls, so a test can prove a later exchange's response genuinely
   * depends on an earlier exchange's message, not just the most recent one. */
  function startAccumulatingEchoServer() {
    const seenTexts: string[] = [];
    return Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          messages: { content: { type: string; text?: string }[] }[];
        };
        const text = body.messages
          .at(-1)
          ?.content.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (text) seenTexts.push(text);
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text: `seen so far: ${seenTexts.join(" | ")}` }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });
  }

  function interactiveConfig(server: ReturnType<typeof startAccumulatingEchoServer>): DhConfig {
    return {
      options: { defaultModel: "test-model" },
      models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
      provider: [
        { name: "mock", type: "anthropic", baseURL: server.url.toString(), apiKey: "sk-test" },
      ],
    };
  }

  test("an interactive root agent pauses 'waiting' (not 'done') after a conversational turn, and a real second exchange references the first", async () => {
    const server = startAccumulatingEchoServer();
    try {
      const events: ServerSentEvent[] = [];
      const runtime = new AgentRuntime({
        config: interactiveConfig(server),
        systemPrompt: "sp",
        interactive: true,
        onEvent: (e) => events.push(e),
      });

      const runPromise = runtime.runRoot("first message");
      // The exchange completing means the root paused "waiting", not that runRoot() resolved.
      while (!events.some((e) => e.type === "agent_status" && e.status === "waiting")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(runtime.getAgentTree()[0]?.status).toBe("waiting");
      expect(
        events.some(
          (e) => e.type === "agent_output" && e.chunk.includes("seen so far: first message"),
        ),
      ).toBe(true);

      // This is the actual bug: before the fix, sendMessageToRoot would either throw
      // RootNotListeningError (the sink was never re-armed) or, if it happened to succeed,
      // nothing downstream would ever run again. Now it must produce a real second turn.
      runtime.sendMessageToRoot("second message");
      while (
        !events.some(
          (e) =>
            e.type === "agent_output" &&
            e.chunk.includes("seen so far: first message | second message"),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(runtime.getAgentTree()[0]?.status).toBe("waiting");

      // Only a genuine stop ends an interactive session — prove the loop is still the same
      // ongoing one by continuing it a third time before finally stopping it.
      runtime.sendMessageToRoot("third message");
      while (
        !events.some(
          (e) =>
            e.type === "agent_output" &&
            e.chunk.includes("seen so far: first message | second message | third message"),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      runtime.stopRoot();
      const result = await runPromise;
      expect(result.success).toBe(false); // stopped, collapsed into "failed" per Round 3's convention
      expect(runtime.getAgentTree()[0]?.status).toBe("failed");
    } finally {
      server.stop(true);
    }
  });

  test("the same multi-exchange behavior works for a sub-agent reachable via SendMessage (not just the root)", async () => {
    const server = startAccumulatingEchoServer();
    try {
      const events: ServerSentEvent[] = [];
      const runtime = new AgentRuntime({
        config: interactiveConfig(server),
        systemPrompt: "sp",
        interactive: true,
        onEvent: (e) => events.push(e),
      });

      const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "test-model",
        prompt: "child first",
      });

      // Round 5 wiring: spawnAgent()'s onEvent handler now mirrors agent_status into the
      // task registry (this.tasks.setStatus) — getAgentTree()/TaskSnapshot.status must
      // reflect "waiting" for the sub-agent too, the same as the root.
      while (runtime.getAgentTree()[0]?.children[0]?.status !== "waiting") {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(
        events.some(
          (e) =>
            e.type === "agent_output" &&
            e.agentId === taskId &&
            e.chunk.includes("seen so far: child first"),
        ),
      ).toBe(true);

      // The exact regression this round fixes, applied to a sub-agent: TaskRegistry.
      // sendMessage() used to reach a loop that could no longer do anything with it once
      // the first exchange had "finished" (task.sendMessage pointed at a dead closure).
      runtime.tasks.sendMessage(taskId, "child second");
      while (
        !events.some(
          (e) =>
            e.type === "agent_output" &&
            e.agentId === taskId &&
            e.chunk.includes("seen so far: child first | child second"),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(runtime.getAgentTree()[0]?.children[0]?.status).toBe("waiting");

      runtime.tasks.stop(taskId);
      await runtime.tasks.awaitDone(taskId);
      expect(runtime.getAgentTree()[0]?.children[0]?.status).toBe("failed");
    } finally {
      server.stop(true);
    }
  });
});

describe("AgentRuntime — Round 6b/6c: config-driven cost pricing and maxTurns", () => {
  test("options.maxTurns from config actually changes when the loop's safety valve fires", async () => {
    const { onEvent, onLogLine, events, logLines } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxTurns: 2 } }),
      systemPrompt: "sp",
      onEvent,
      onLogLine,
    });
    const result = await runtime.runRoot("loop-forever please");
    expect(result.success).toBe(false);
    const failedLog = logLines.find((l) => l.type === "failed");
    expect(failedLog && "reason" in failedLog ? failedLog.reason : undefined).toContain(
      "exceeded max turns (2)",
    );
    const sessionEnded = events.find((e) => e.type === "session_ended");
    expect(sessionEnded).toMatchObject({ exitCode: ExitCode.TaskFailure });
  });

  test("a configured model price produces a real (non-zero) costUsd on token_usage events", async () => {
    const { onEvent, events } = collectors();
    const runtime = new AgentRuntime({
      config: baseConfig({
        models: [
          {
            name: "test-model",
            provider: "mock",
            model: "mock-1",
            inputPricePerMToken: 3,
            outputPricePerMToken: 15,
          },
        ],
      }),
      systemPrompt: "sp",
      onEvent,
    });
    await runtime.runRoot("please just answer");
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent?.type).toBe("token_usage");
    expect(usageEvent && "costUsd" in usageEvent ? usageEvent.costUsd : undefined).toBeGreaterThan(
      0,
    );
  });

  test("an unconfigured model's token_usage events still have costUsd undefined (no regression)", async () => {
    const { onEvent, events } = collectors();
    const runtime = new AgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    await runtime.runRoot("please just answer");
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent?.type).toBe("token_usage");
    expect(usageEvent && "costUsd" in usageEvent ? usageEvent.costUsd : undefined).toBeUndefined();
  });
});
