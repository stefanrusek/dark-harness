// Integration tests for AgentRuntime — the composition root that wires dh.json config,
// provider adapters, the tool set, and the task registry together (docs/handoffs/core.md §4).
//
// These deliberately exercise the real AnthropicProvider (not a stubbed ModelProvider)
// against a local mock Anthropic-compatible HTTP server, since createProvider() always
// builds a real adapter from config — the same "local provider" path the sample dh.json
// documents (custom baseURL). This gives real end-to-end coverage of config -> provider ->
// loop -> tool dispatch without ever touching the network.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentTreeNode,
  type DhConfig,
  ExitCode,
  type LogLine,
  type ServerSentEvent,
} from "../contracts/index.ts";
import {
  AgentRuntime,
  type AgentRuntimeOptions,
  ConfigModelError,
  ROOT_AGENT_ID,
  RootNotListeningError,
} from "./runtime.ts";
import { bashTool } from "./tools/bash.ts";

/** Round 8: `AgentRuntimeOptions.client` is required (no default) so no real call site can
 * silently record a wrong value in a log header — but nearly every test in this suite
 * predates that field and doesn't care which value it takes. This helper defaults it to
 * `"none"` (the standalone/no-client value) so existing fixtures don't need to repeat it at
 * every call site; tests that specifically care about `client` still override it. */
function newAgentRuntime(
  options: Omit<AgentRuntimeOptions, "client"> & Partial<Pick<AgentRuntimeOptions, "client">>,
) {
  return new AgentRuntime({ client: "none", ...options });
}

/** A minimal Anthropic Messages API-shaped mock server. Decides its response from the last
 * message's content, independent of call ordering, so it stays correct under the
 * concurrent sub-agent scenarios this suite exercises. */
function startMockAnthropicServer(onRequest?: (body: { model: string }) => void) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as {
        model: string;
        messages: { role: string; content: { type: string; text?: string }[] }[];
      };
      onRequest?.(body);
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
                input: {
                  prompt: "child instruction",
                  description: "Child instruction",
                  run_in_background: false,
                },
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
        if (text.includes("use-toolsearch-select-and-call")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_search_select",
                name: "ToolSearch",
                input: { query: "select:mcp__fixture__echo" },
              },
            ],
            "tool_use",
          );
        }
        if (
          text.includes("use-toolsearch") &&
          !text.includes("select-and-call") &&
          !text.includes("unreachable")
        ) {
          return message(
            [{ type: "tool_use", id: "tu_search", name: "ToolSearch", input: { query: "q" } }],
            "tool_use",
          );
        }
        if (text.includes("use-toolsearch-unreachable")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_search_unreachable",
                name: "ToolSearch",
                input: { query: "anything" },
              },
            ],
            "tool_use",
          );
        }
        // Round 12 test support: a real run_in_background Bash/Agent call whose completion
        // should be proactively delivered into the (interactive) root's conversation.
        if (text.includes("use-background-bash-tool")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_bgbash",
                name: "Bash",
                input: { command: "sleep 0.05 && echo hi", run_in_background: true },
              },
            ],
            "tool_use",
          );
        }
        if (text.includes("use-background-agent-tool")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_bgagent",
                name: "Agent",
                input: {
                  prompt: "child instruction",
                  description: "Child instruction",
                  run_in_background: true,
                },
              },
            ],
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
        // DH-0077 test support: writes a file into the sub-agent's cwd, so a worktree-
        // isolation test can assert the file lands in the isolated worktree (and that the
        // worktree — now having changes — is retained rather than auto-cleaned).
        if (text.includes("use-bash-write-file")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_bash_write",
                name: "Bash",
                input: {
                  command: "echo hello > new-file.txt",
                  run_in_background: false,
                },
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
        // DH-0074 test support: calls WebFetch by name regardless of whether it's actually
        // registered on this runtime — lets a test assert "Unknown tool" dispatch when
        // web.fetch isn't configured, vs. a real fetch when it is.
        if (text.includes("call-webfetch-tool-by-name")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_webfetch_probe",
                name: "WebFetch",
                input: { url: "http://8.8.8.8/" },
              },
            ],
            "tool_use",
          );
        }
        {
          const webfetchMatch = /use-webfetch (\S+)/.exec(text);
          if (webfetchMatch?.[1]) {
            return message(
              [
                {
                  type: "tool_use",
                  id: "tu_webfetch",
                  name: "WebFetch",
                  input: { url: webfetchMatch[1], prompt: "what is this page about?" },
                },
              ],
              "tool_use",
            );
          }
        }
        if (text === "child instruction") {
          return message([{ type: "text", text: "child done" }], "end_turn");
        }
        if (text.includes("fail please")) {
          return message([{ type: "text", text: "could not do it TASK_FAILED" }], "end_turn");
        }
        return message([{ type: "text", text: "root done" }], "end_turn");
      }

      // After ToolSearch's `select:` activation, issue a real call to the now-activated MCP
      // tool on the very next turn — proving activation + per-turn toolDefs + dispatch all
      // work end to end, not just that ToolSearch's own output looks right.
      const toolResultBlock = (
        content as unknown as Array<{ type: string; tool_use_id?: string }>
      ).find((c) => c.type === "tool_result");
      if (toolResultBlock?.tool_use_id === "tu_search_select") {
        return message(
          [
            {
              type: "tool_use",
              id: "tu_call_fixture_echo",
              name: "mcp__fixture__echo",
              input: { text: "round-trip" },
            },
          ],
          "tool_use",
        );
      }

      return message([{ type: "text", text: "finished after tool" }], "end_turn");
    },
  });
}

let server: ReturnType<typeof startMockAnthropicServer>;
let receivedModels: string[] = [];

beforeAll(() => {
  server = startMockAnthropicServer((req) => {
    receivedModels.push(req.model);
  });
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
    const runtime = newAgentRuntime({
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
    // Round 8 (ADR 0005 amendment): the header carries client (threaded from
    // AgentRuntimeOptions.client, defaulted to "none" by this suite's helper) and build
    // (the process-wide BUILD_INFO constant — version is always present even unstamped).
    if (logLines[0]?.type === "header") {
      expect(logLines[0].client).toBe("none");
      expect(logLines[0].build.version.length).toBeGreaterThan(0);
    }
    // onLogLine's agentId param (a Round 2 addition) is threaded correctly for the root.
    expect(loggedAgentIds.every((id) => id === ROOT_AGENT_ID)).toBe(true);
    expect(loggedAgentIds.length).toBeGreaterThan(0);
    // Cross-domain contract: Server's waitForExitCode (src/server/exit.ts on main)
    // subscribes to this event to resolve --job's exit code.
    const sessionEnded = events.find((e) => e.type === "session_ended");
    expect(sessionEnded).toMatchObject({ type: "session_ended", exitCode: ExitCode.Success });
  });

  // Round 11 regression (docs/handoffs/core.md status log): every provider call was sending
  // ModelConfig.name (the friendly config alias) instead of ModelConfig.model (the real
  // provider-side id) — confirmed live against real AWS Bedrock, masked everywhere else
  // (LM Studio ignores the field; Anthropic tests failed on auth first). baseConfig()'s
  // fixture deliberately has name "test-model" != model "mock-1" so this can't pass by
  // accident the way it would if the two happened to match.
  test("runRoot sends the config's provider-side model id, not the friendly alias, to the real HTTP request", async () => {
    receivedModels = [];
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "you are a test agent" });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
    expect(receivedModels.length).toBeGreaterThan(0);
    expect(receivedModels.every((m) => m === "mock-1")).toBe(true);
    expect(receivedModels.some((m) => m === "test-model")).toBe(false);
  });

  test("runRoot emits session_ended with TaskFailure when the root agent self-reports failure", async () => {
    const { events, onEvent } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    const result = await runtime.runRoot("fail please");
    expect(result.success).toBe(false);
    const sessionEnded = events.find((e) => e.type === "session_ended");
    expect(sessionEnded).toMatchObject({ type: "session_ended", exitCode: ExitCode.TaskFailure });
  });

  test("runRoot accepts an explicit model name overriding options.defaultModel", async () => {
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "you are a test agent",
    });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
  });

  test("sessionId defaults to a generated id when not provided", () => {
    const a = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const b = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionId.length).toBeGreaterThan(0);
  });

  // DH-0012 (tracking/DH-0012-unbounded-memory-growth-across-harness.md): AgentRuntime
  // threads config.limits.completedRetention into its TaskRegistry's eviction cap.
  test("config.limits.completedRetention threads into the runtime's TaskRegistry eviction cap", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({ limits: { completedRetention: 1 } }),
      systemPrompt: "sp",
    });
    const first = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(first);
    const second = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(second);
    // Cap of 1 — the first task is evicted once the second one also completes.
    expect(runtime.tasks.trySnapshot(first)).toBeUndefined();
    expect(runtime.tasks.snapshot(second).status).toBe("done");
  });

  test("sessionId honors an explicit override", () => {
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      sessionId: "session-fixed",
    });
    expect(runtime.sessionId).toBe("session-fixed");
  });

  test("spawnAgent starts a task that reaches 'done' and carries the sub-agent's output", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(() => runtime.spawnAgent("agent-root", { model: "nope", prompt: "x" })).toThrow(
      ConfigModelError,
    );
  });

  test("runRoot rejects when the resolved model references an unknown provider", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({
        provider: [{ name: "someone-else", type: "anthropic" }],
      }),
      systemPrompt: "sp",
    });
    await expect(runtime.runRoot("please just answer")).rejects.toThrow(ConfigModelError);
  });

  test("providerFor caches and reuses the same provider instance across calls", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const first = await runtime.runRoot("please just answer");
    const second = await runtime.runRoot("please just answer");
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  test("buildToolContext wires spawnAgent so the Agent tool can block on a sub-agent", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const result = await runtime.runRoot("use-agent-tool");
    expect(result.success).toBe(true);
  });

  test("buildToolContext wires loadSkill so the Skill tool can look it up", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({ skillPaths: ["/nonexistent"] }),
      systemPrompt: "sp",
    });
    const result = await runtime.runRoot("use-skill-tool");
    // The skill isn't found (no such path) but the wiring itself must not throw — the
    // Bash-style tool_result error is fed back and the loop still completes.
    expect(result.success).toBe(true);
  });

  test("buildToolContext wires searchDeferredTools so the ToolSearch tool can query it", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({ mcpServers: { docs: { url: "https://example.com" } } }),
      systemPrompt: "sp",
    });
    const result = await runtime.runRoot("use-toolsearch");
    expect(result.success).toBe(true);
  });

  test("DH-0002: select: activates a real MCP tool discovered from a configured stdio " +
    "server, and the very next turn can call it and get real output back", async () => {
    const { logLines, onLogLine } = collectors();
    const fixturePath = fileURLToPath(
      new URL("./mcp/__fixtures__/fake-stdio-server.ts", import.meta.url),
    );
    const runtime = newAgentRuntime({
      config: baseConfig({
        mcpServers: { fixture: { command: process.execPath, args: ["run", fixturePath] } },
      }),
      systemPrompt: "sp",
      onLogLine,
    });
    // Give the runtime's eager, fire-and-forget connectAll() a beat to finish so the first
    // ToolSearch call's own corpus-touching reconnect isn't racing it (DH-0002 §3/§6) —
    // exercised deliberately unawaited elsewhere; this test cares about the steady state.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await runtime.runRoot("use-toolsearch-select-and-call");
    expect(result.success).toBe(true);

    const toolResults = logLines.filter((l) => l.type === "tool_result");
    const searchResult = toolResults.find(
      (l) => l.type === "tool_result" && l.toolUseId === "tu_search_select",
    );
    expect(
      searchResult && searchResult.type === "tool_result" ? searchResult.output : "",
    ).toContain("mcp__fixture__echo");
    const echoResult = toolResults.find(
      (l) => l.type === "tool_result" && l.toolUseId === "tu_call_fixture_echo",
    );
    expect(echoResult && echoResult.type === "tool_result" ? echoResult.output : "").toBe(
      "echo: round-trip",
    );
    await runtime.close();
  });

  test("DH-0002: ToolSearch's footer lists a currently-unreachable configured MCP server", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({
        mcpServers: { broken: { command: "/definitely/does/not/exist/mcp-server" } },
      }),
      systemPrompt: "sp",
      onLogLine,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await runtime.runRoot("use-toolsearch-unreachable");
    expect(result.success).toBe(true);
    const searchResult = logLines.find(
      (l) => l.type === "tool_result" && l.toolUseId === "tu_search_unreachable",
    );
    const output = searchResult && searchResult.type === "tool_result" ? searchResult.output : "";
    expect(output).toContain("broken");
    expect(output).toContain("Unreachable");
    await runtime.close();
  });

  test("DH-0002: AgentRuntime.close() closes the shared McpManager (terminates stdio " +
    "children) without throwing, even with no mcpServers configured", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  test("buildToolContext defaults cwd to process.cwd() when not overridden", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const result = await runtime.runRoot("use-bash-pwd");
    expect(result.success).toBe(true);
    const toolResult = logLines.find((l) => l.type === "tool_result");
    const output = toolResult && toolResult.type === "tool_result" ? toolResult.output : "";
    expect(typeof output === "string" ? output.trim() : "").toBe(process.cwd());
  });

  test("buildToolContext honors an explicit cwd override", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({
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

  test("DH-0070: each concurrently-spawned sub-agent sees its own agent's cwd, not " +
    "another agent's or the process's — per-agent cwd is captured at spawn time, not read " +
    "from one shared runtime-wide field", async () => {
    const dirA = realpathSync("/tmp");
    const dirB = realpathSync(mkdtempSync(join(tmpdir(), "dh-cwd-b-")));
    const { logLines: logLinesA, onLogLine: onLogLineA } = collectors();
    const { logLines: logLinesB, onLogLine: onLogLineB } = collectors();
    const runtimeA = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      cwd: dirA,
      onLogLine: onLogLineA,
    });
    const runtimeB = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      cwd: dirB,
      onLogLine: onLogLineB,
    });
    // Two sub-agents, each spawned from a *different* runtime instance (so their own root
    // cwds genuinely diverge), run concurrently — proving neither the process's own cwd nor
    // one runtime's cwd leaks into the other's sub-agent, and that a real process.cwd()
    // change (below) doesn't silently become either agent's effective cwd.
    const originalProcessCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const [taskIdA, taskIdB] = [
        runtimeA.spawnAgent(ROOT_AGENT_ID, { model: "test-model", prompt: "use-bash-pwd" }),
        runtimeB.spawnAgent(ROOT_AGENT_ID, { model: "test-model", prompt: "use-bash-pwd" }),
      ];
      await Promise.all([runtimeA.tasks.awaitDone(taskIdA), runtimeB.tasks.awaitDone(taskIdB)]);
    } finally {
      process.chdir(originalProcessCwd);
    }

    const pwdOutput = (lines: LogLine[]) => {
      const toolResult = lines.find((l) => l.type === "tool_result");
      const output = toolResult && toolResult.type === "tool_result" ? toolResult.output : "";
      return typeof output === "string" ? output.trim() : "";
    };
    expect(pwdOutput(logLinesA)).toBe(dirA);
    expect(pwdOutput(logLinesB)).toBe(dirB);
    // Neither sub-agent ever saw the process's own (temporarily-changed) cwd, nor the
    // sibling runtime's cwd.
    expect(pwdOutput(logLinesA)).not.toBe(dirB);
    expect(pwdOutput(logLinesB)).not.toBe(dirA);
    expect(pwdOutput(logLinesA)).not.toBe(tmpdir());
    expect(pwdOutput(logLinesB)).not.toBe(tmpdir());
  });

  test("an explicit tools option restricts the tool map away from ALL_TOOLS", async () => {
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(runtime.rootHasStarted).toBe(false);
    await runtime.runRoot("please just answer");
    expect(runtime.rootHasStarted).toBe(true);
  });

  test("getAgentTree() includes a 'waiting' root node before the root agent has started", () => {
    // Round 2 correction (found via a live integration test against a real DhServer): an
    // empty tree pre-start makes the root unreachable by Server's own send_message
    // validation (src/server/commands.ts's findAgent check runs before AgentLoopHandle.
    // sendMessage() is ever called) — see runtime.ts's rootStatus field doc comment.
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await runtime.runRoot("fail please");
    expect(runtime.getAgentTree()[0]?.status).toBe("failed");
  });

  test("getAgentTree() nests agent-kind sub-agents under their parent, excluding bash-kind tasks", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
      const runtime = newAgentRuntime({
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
      const runtime = newAgentRuntime({ config, systemPrompt: "sp", onEvent });
      const rootPromise = runtime.runRoot("go");
      // Give the fetch a moment to actually be in flight before stopping it.
      await new Promise((resolve) => setTimeout(resolve, 20));
      runtime.stopRoot();
      const result = await rootPromise;
      expect(result.success).toBe(false);
      const statusEvent = events.find((e) => e.type === "agent_status");
      // DH-0017 fix: a deliberate stop reports "stopped", not "failed".
      expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe(
        "stopped",
      );
    } finally {
      slowServer.stop(true);
    }
  });

  test("stopRoot() before runRoot() has ever been called is a safe no-op", () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(() => runtime.stopRoot()).not.toThrow();
  });

  test("stopRoot() after the root has already finished is a safe no-op", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
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
      const runtime = newAgentRuntime({ config, systemPrompt: "sp" });
      const taskId = runtime.spawnAgent(ROOT_AGENT_ID, { model: "test-model", prompt: "go" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      runtime.tasks.stop(taskId);
      await runtime.tasks.awaitDone(taskId);
      // Before Round 3, tasks.stop() only ever updated registry bookkeeping — the loop
      // itself kept running (and the fetch kept hanging) regardless. awaitDone() resolving
      // at all here (rather than this test timing out) is the actual proof of the fix; the
      // status assertion below is a secondary sanity check. DH-0017 fix: reports "stopped",
      // not "failed" — see loop.ts's reportStopped() doc comment for why this used to flip.
      expect(runtime.tasks.snapshot(taskId).status).toBe("stopped");
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
      const runtime = newAgentRuntime({ config: crashingConfig(server), systemPrompt: "sp" });
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
      const runtime = newAgentRuntime({
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
      const runtime = newAgentRuntime({ config: crashingConfig(server), systemPrompt: "sp" });
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
      const runtime = newAgentRuntime({
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
      // DH-0017 fix: a deliberate stop reports "stopped" everywhere, not "failed" — the root
      // conversation didn't succeed, but it also wasn't a self-reported/harness failure.
      // DH-0059: stopping while paused "waiting" (as it is here) is a graceful end of the
      // conversation, so `success` is true (unlike a stop mid-work).
      expect(result.success).toBe(true);
      expect(runtime.getAgentTree()[0]?.status).toBe("stopped");
    } finally {
      server.stop(true);
    }
  });

  // Round 7 (docs/handoffs/core.md status log): E2E found that spawnAgent() used to pass
  // the runtime-instance `interactive` flag into every sub-agent too, so a sub-agent spawned
  // from an interactive root inherited Round 5's "pause instead of end" semantics — but a
  // sub-agent has no operator to send it more messages, so it hung "waiting" forever instead
  // of ever reaching "done"/"failed", silently breaking the Agent tool's blocking
  // (`run_in_background: false`) mode. This replaces the old (now-wrong) test above, which
  // asserted the sub-agent *should* pause "waiting" after its first exchange — that was
  // exactly the bug, encoded as an expectation. A sub-agent's own conversation now always
  // ends on its first non-tool-use turn, regardless of the root's mode; only
  // `SendMessage`-driven steering of a still-*running* (tool-using) sub-agent survives, since
  // `registerSendMessage`'s pending-message queue in loop.ts is wired up unconditionally, not
  // gated on `interactive`.
  test("a sub-agent spawned from an interactive root still reaches 'done' on its first non-tool-use turn (not stuck 'waiting' forever)", async () => {
    const server = startAccumulatingEchoServer();
    try {
      const runtime = newAgentRuntime({
        config: interactiveConfig(server),
        systemPrompt: "sp",
        interactive: true,
      });

      const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "test-model",
        prompt: "child first",
      });

      // This resolving at all (rather than hanging until bun's test timeout) is the actual
      // proof: before the fix, this sub-agent inherited `interactive: true` and would pause
      // "waiting" after its one and only exchange, so awaitDone() would never settle.
      await runtime.tasks.awaitDone(taskId);
      const snapshot = runtime.tasks.snapshot(taskId);
      expect(snapshot.status).toBe("done");
      expect(snapshot.output).toContain("seen so far: child first");
    } finally {
      server.stop(true);
    }
  });

  test("SendMessage can still steer a still-running (tool-using) sub-agent under an interactive root, even though it now terminates instead of waiting", async () => {
    const { onLogLine, logLines } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      interactive: true,
      onLogLine,
    });

    // "loop-forever" (see startMockAnthropicServer above) keeps issuing tool_use turns
    // regardless of tool_result feedback, so the sub-agent stays "running" (never reaches a
    // non-tool-use turn) long enough to prove a mid-flight SendMessage is actually picked up
    // by the loop while it's still going — this is the steering path Round 7's fix must not
    // regress, since it's unconditional in loop.ts (not gated on `interactive`).
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "loop-forever please",
    });

    while (runtime.getAgentTree()[0]?.children[0]?.status !== "running") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    runtime.tasks.sendMessage(taskId, "steer now");

    // loop.ts logs every injected pending message as a new "user" message line at the top of
    // its next turn (regardless of `interactive`) — this is the actual proof the sendMessage
    // sink is still live and consumed mid-conversation for a sub-agent, not just for the
    // root. The mock's "loop-forever" branch itself never produces this text, so it can only
    // appear here via the real injection path.
    while (
      !logLines.some((l) => l.type === "message" && l.role === "user" && l.content === "steer now")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    runtime.tasks.stop(taskId);
    await runtime.tasks.awaitDone(taskId);
    // DH-0017 fix: a deliberately-stopped task reports "stopped" consistently, not "failed".
    expect(runtime.getAgentTree()[0]?.children[0]?.status).toBe("stopped");
  });

  test("the Agent tool's blocking mode (run_in_background: false) actually resolves for a sub-agent spawned from an interactive root", async () => {
    const events: ServerSentEvent[] = [];
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      interactive: true,
      onEvent: (e) => events.push(e),
    });

    // "use-agent-tool" makes the root call the Agent tool with run_in_background: false,
    // which awaits ctx.tasks.awaitDone(taskId) internally (src/agent/tools/agent.ts) before
    // the root's own tool_use turn can get a tool_result back and continue. Before the Round
    // 7 fix, the spawned child ("child instruction" -> a plain non-tool-use reply) would
    // inherit interactive: true and pause "waiting" forever, so awaitDone() never resolved,
    // the Agent tool call never returned a tool_result, and the root's conversation could
    // never proceed to its own next (interactive) turn — this test only passes if that whole
    // chain actually completes.
    const runPromise = runtime.runRoot("use-agent-tool");
    while (!events.some((e) => e.type === "agent_status" && e.status === "waiting")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(runtime.getAgentTree()[0]?.status).toBe("waiting");
    expect(events.some((e) => e.type === "agent_output" && e.chunk === "finished after tool")).toBe(
      true,
    );
    // The sub-agent itself reached a real terminal state, not stuck "waiting".
    expect(runtime.getAgentTree()[0]?.children[0]?.status).toBe("done");

    runtime.stopRoot();
    const result = await runPromise;
    // DH-0017: stopped, reported as "stopped", not "failed". DH-0059: the root was paused
    // "waiting" (asserted above) when stopped, so this is a graceful end — success: true.
    expect(result.success).toBe(true);
  });
});

describe("AgentRuntime — Round 6b/6c: config-driven cost pricing and maxTurns", () => {
  test("options.maxTurns from config actually changes when the loop's safety valve fires", async () => {
    const { onEvent, onLogLine, events, logLines } = collectors();
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({
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
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    await runtime.runRoot("please just answer");
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent?.type).toBe("token_usage");
    expect(usageEvent && "costUsd" in usageEvent ? usageEvent.costUsd : undefined).toBeUndefined();
  });
});

describe("AgentRuntime — DH-0013: session-wide budgets", () => {
  // The mock server always reports usage: { input_tokens: 5, output_tokens: 5 } — a single
  // exchange is exactly 10 tokens.

  test("maxTotalTokens stops the session once cumulative tokens reach the cap", async () => {
    const { onEvent, onLogLine, events, logLines } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxTotalTokens: 10 } }),
      systemPrompt: "sp",
      onEvent,
      onLogLine,
    });
    const result = await runtime.runRoot("loop-forever please");
    expect(result.success).toBe(false);
    expect(
      logLines.some(
        (l) =>
          l.type === "message" &&
          l.role === "system" &&
          l.content.includes("Session budget exceeded"),
      ),
    ).toBe(true);
    expect(
      logLines.some(
        (l) => l.type === "message" && l.role === "system" && l.content.includes("maxTotalTokens"),
      ),
    ).toBe(true);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe(
      "stopped",
    );
  });

  test("maxCostUsd stops the session once cumulative cost reaches the cap", async () => {
    const { onLogLine, logLines } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({
        options: { defaultModel: "test-model", maxCostUsd: 0.00001 },
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
      onLogLine,
    });
    const result = await runtime.runRoot("loop-forever please");
    expect(result.success).toBe(false);
    expect(
      logLines.some(
        (l) => l.type === "message" && l.role === "system" && l.content.includes("maxCostUsd"),
      ),
    ).toBe(true);
  });

  test("no budget configured never trips (no regression)", async () => {
    const { onLogLine, logLines } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
    expect(logLines.some((l) => l.type === "message" && l.content.includes("budget"))).toBe(false);
  });

  test("maxWallClockMs stops a long-running interactive session even though turn count never fires", async () => {
    const { onEvent, onLogLine, events, logLines } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxWallClockMs: 50 } }),
      systemPrompt: "sp",
      interactive: true,
      onEvent,
      onLogLine,
    });
    // Interactive root pauses "waiting" after its first exchange — nothing else would ever
    // end this session except the wall-clock budget.
    const runPromise = runtime.runRoot("please just answer");
    const result = await runPromise;
    // DH-0059: the budget fires while the root is paused "waiting" (per the comment above),
    // so this is the graceful-stop path — success: true, not a task failure.
    expect(result.success).toBe(true);
    expect(
      logLines.some(
        (l) => l.type === "message" && l.role === "system" && l.content.includes("maxWallClockMs"),
      ),
    ).toBe(true);
    const statusEvent = events.filter((e) => e.type === "agent_status").pop();
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe(
      "stopped",
    );
  }, 2000);

  test("maxAgentDepth refuses a sub-agent spawn past the configured nesting limit", () => {
    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxAgentDepth: 1 } }),
      systemPrompt: "sp",
    });
    // Root is depth 0; a direct sub-agent (depth 1) is allowed...
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
    });
    expect(() => runtime.spawnAgent(taskId, { model: "test-model", prompt: "grandchild" })).toThrow(
      /nesting depth/,
    );
  });

  test("maxConcurrentAgents refuses a spawn once the live-agent cap is reached", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxConcurrentAgents: 1 } }),
      systemPrompt: "sp",
    });
    // First spawn (blocking, background: false) occupies the one concurrency slot until it
    // resolves — but since we don't await it yet, a second spawn attempted meanwhile refuses.
    runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
      background: true,
    });
    expect(() =>
      runtime.spawnAgent(ROOT_AGENT_ID, { model: "test-model", prompt: "child instruction" }),
    ).toThrow(/maxConcurrentAgents/);
  });

  test("DH-0077: isolation: 'worktree' points the sub-agent's cwd at a fresh worktree, " +
    "auto-cleaned up when it has no changes", async () => {
    const repo = mkdtempSync(join(tmpdir(), "dh-runtime-wt-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "hi\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      cwd: repo,
      onLogLine,
    });
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "use-bash-pwd",
      isolation: "worktree",
    });
    await runtime.tasks.awaitDone(taskId);
    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.status).toBe("done");

    const toolResult = logLines.find((l) => l.type === "tool_result");
    const output = toolResult && toolResult.type === "tool_result" ? toolResult.output : "";
    const pwd = typeof output === "string" ? output.trim() : "";
    // The sub-agent's cwd was the worktree, not the repo itself.
    expect(pwd).not.toBe(realpathSync(repo));
    expect(pwd).toContain("dh-worktrees-");
    // Worktree had no changes (just ran `pwd`) — cleaned up automatically.
    expect(existsSync(pwd)).toBe(false);
  });

  test("DH-0077: a worktree left with changes is retained and reported back, not deleted", async () => {
    const repo = mkdtempSync(join(tmpdir(), "dh-runtime-wt-changes-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "hi\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", cwd: repo });
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "use-bash-write-file",
      isolation: "worktree",
    });
    await runtime.tasks.awaitDone(taskId);
    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.status).toBe("done");
    expect(snapshot.output).toContain("[isolation worktree] changes retained at");
    const pathMatch = snapshot.output.match(/changes retained at (\S+) on branch (\S+)/);
    expect(pathMatch).not.toBeNull();
    const worktreePath = pathMatch?.[1];
    if (!worktreePath) throw new Error("expected a worktree path in the output");
    // Not cleaned up: the worktree directory (and its new file) should still exist.
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(join(worktreePath, "new-file.txt"))).toBe(true);
    // Clean up manually so the test doesn't leak a worktree registration in the repo.
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: repo });
  });

  test("DH-0077: refuses isolation: 'worktree' when the parent's cwd isn't a git repo", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "dh-runtime-wt-notrepo-"));
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", cwd: notARepo });
    expect(() =>
      runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "test-model",
        prompt: "child instruction",
        isolation: "worktree",
      }),
    ).toThrow(/git repository/);
  });

  test("DH-0077: caps concurrent worktree creation, tied to maxConcurrentAgents", async () => {
    const repo = mkdtempSync(join(tmpdir(), "dh-runtime-wt-cap-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "hi\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxConcurrentAgents: 1 } }),
      systemPrompt: "sp",
      cwd: repo,
    });
    runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
      background: true,
      isolation: "worktree",
    });
    expect(() =>
      runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "test-model",
        prompt: "child instruction",
        isolation: "worktree",
      }),
    ).toThrow(/already live/);
  });

  test("the Agent tool surfaces a fan-out refusal as a normal tool-error, not an uncaught exception", async () => {
    const { onEvent } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({ options: { defaultModel: "test-model", maxAgentDepth: 0 } }),
      systemPrompt: "sp",
      onEvent,
    });
    const result = await runtime.runRoot("use-agent-tool");
    // maxAgentDepth: 0 means even a direct root->child spawn (depth 1) is refused — the
    // Agent tool call inside the loop gets a tool-error result back, not a crash, so the
    // root's own conversation continues normally to its next turn instead of the whole
    // runRoot() call throwing.
    expect(result.success).toBe(true);
  });
});

describe("AgentRuntime — Round 12: proactive push notification on background task/sub-agent completion", () => {
  test("a real background Bash task's completion is proactively delivered into a waiting interactive root's conversation, not just retrievable via TaskOutput", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      interactive: true,
      onLogLine,
    });

    const runPromise = runtime.runRoot("use-background-bash-tool");
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !logLines.some(
        (l) =>
          l.type === "message" && l.role === "user" && l.content.includes("Background Bash task"),
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runtime.stopRoot();
    await runPromise;

    const injected = logLines.find(
      (l) =>
        l.type === "message" && l.role === "user" && l.content.includes("Background Bash task"),
    );
    expect(injected).toBeDefined();
    if (injected?.type === "message") {
      expect(injected.content).toContain("completed");
      expect(injected.content).toContain("hi"); // the command's own stdout, echoed back
    }
    // Confirms this actually reached the root's own conversation loop (a real second
    // provider turn), not merely that TaskRegistry recorded it — this is exactly the
    // "root never checked back on its own" failure mode the round's handoff describes.
    expect(
      logLines.filter((l) => l.type === "message" && l.role === "assistant").length,
    ).toBeGreaterThan(1);
  });

  test("a real background sub-agent (Agent tool)'s completion is proactively delivered into a waiting interactive root's conversation", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      interactive: true,
      onLogLine,
    });

    const runPromise = runtime.runRoot("use-background-agent-tool");
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !logLines.some(
        (l) => l.type === "message" && l.role === "user" && l.content.includes("Sub-agent"),
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runtime.stopRoot();
    await runPromise;

    const injected = logLines.find(
      (l) => l.type === "message" && l.role === "user" && l.content.includes("Sub-agent"),
    );
    expect(injected).toBeDefined();
    if (injected?.type === "message") {
      expect(injected.content).toContain("completed");
      expect(injected.content).toContain("child done");
    }
  });

  test("a background task's completion is proactively delivered to a still-running/waiting parent sub-agent, not only the root", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const delivered: string[] = [];

    const parentId = runtime.tasks.start({
      kind: "agent",
      parentAgentId: ROOT_AGENT_ID,
      background: true,
      run: async (handle) => {
        handle.registerSendMessage((message) => delivered.push(message));
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });
    // The parent's own settle-callback would otherwise race the assertions below (it starts
    // "running" only once start() returns) — mirrors how spawnAgent() keeps the task
    // registry's status in sync with the loop's own transitions (see runtime.ts's onEvent
    // handler in spawnAgent()).
    runtime.tasks.setStatus(parentId, "running");

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: parentId,
      background: true,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(childId);

    expect(
      delivered.some((m) => m.includes("Background Bash task") && m.includes("completed")),
    ).toBe(true);
    expect(
      logLines.some(
        (l) =>
          l.type === "message" &&
          l.role === "system" &&
          l.content.includes("delivered live to parent agent"),
      ),
    ).toBe(true);
  });

  test("orphaned grandchild: if the parent has already finished, the notification is not lost — it's recorded as a system log line instead", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const delivered: string[] = [];

    const parentId = runtime.tasks.start({
      kind: "agent",
      parentAgentId: ROOT_AGENT_ID,
      background: true,
      run: async (handle) => {
        handle.registerSendMessage((message) => delivered.push(message));
      },
    });
    // The parent's own turn (and its whole loop) ends before its grandchild does — the
    // exact edge case the handoff raised directly.
    await runtime.tasks.awaitDone(parentId);
    expect(runtime.tasks.snapshot(parentId).status).toBe("done");

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: parentId,
      background: true,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(childId);

    expect(delivered).toEqual([]); // never delivered live — parent wasn't listening anymore
    const notice = logLines.find(
      (l) =>
        l.type === "message" &&
        l.role === "system" &&
        l.content.includes("Background Bash task") &&
        l.content.includes("NOT be delivered live"),
    );
    expect(notice).toBeDefined();
    if (notice?.type === "message") {
      expect(notice.content).toContain("orphaned or already finished");
    }
  });

  test("a background task's completion is not falsely delivered to a root that hasn't started yet, even though rootStatus defaults to 'waiting'", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      background: true,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(childId);

    const notice = logLines.find(
      (l) =>
        l.type === "message" && l.role === "system" && l.content.includes("Background Bash task"),
    );
    expect(notice).toBeDefined();
    if (notice?.type === "message") {
      expect(notice.content).toContain("NOT be delivered live");
    }
  });

  test("a foreground (background: false) task's completion never fires a completion notification", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      background: false,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(childId);

    expect(logLines.some((l) => l.type === "message" && l.role === "system")).toBe(false);
  });

  test("a failed background task's notification reports the failure reason", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      background: true,
      run: async () => {
        throw new Error("boom");
      },
    });
    await runtime.tasks.awaitDone(childId);

    const notice = logLines.find((l) => l.type === "message" && l.role === "system");
    expect(notice).toBeDefined();
    if (notice?.type === "message") {
      expect(notice.content).toContain("failed: boom");
    }
  });
});

// DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16): composeTools()
// wiring (web tool registration is presence-gated) and ToolContext.completeWithModel (the
// extraction-model call WebFetch makes, and its session-accounting feed).
describe("AgentRuntime — DH-0074 web tool wiring", () => {
  test("composeTools() is used instead of ALL_TOOLS: web absent -> WebFetch is not callable at all", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const result = await runtime.runRoot("call-webfetch-tool-by-name");
    expect(result.success).toBe(true);
    const toolResult = logLines.find(
      (l) => l.type === "tool_result" && l.toolUseId === "tu_webfetch_probe",
    );
    expect(toolResult && toolResult.type === "tool_result" ? toolResult.output : "").toBe(
      "Unknown tool: WebFetch",
    );
  });

  test("web.fetch configured -> WebFetch actually runs end-to-end, and its extraction-model " +
    "call (completeWithModel) feeds the same token_usage/session-accounting path as a normal turn", async () => {
    const pageServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("This page is about bun test fixtures.", {
          headers: { "content-type": "text/plain" },
        });
      },
    });
    try {
      const { events, onEvent } = collectors();
      const runtime = newAgentRuntime({
        config: baseConfig({
          web: {
            fetch: {
              // The fixture server binds to 127.0.0.1 — a private address — so the SSRF
              // check must be deliberately bypassed for this test, exactly as a real
              // operator pointing WebFetch at an internal docs server would configure it.
              allowPrivateNetwork: true,
              extractionModel: "test-model",
            },
          },
        }),
        systemPrompt: "sp",
        onEvent,
      });

      const webfetchUrl = pageServer.url.toString();
      const result = await runtime.runRoot(`use-webfetch ${webfetchUrl}`);
      expect(result.success).toBe(true);

      // The extraction call is a second, independent completion call against the same mock
      // provider — the mock server's default (non-tool-result, non-matching-trigger) branch
      // replies with "root done", so the WebFetch tool_result content should be exactly that.
      const tokenUsageEvents = events.filter((e) => e.type === "token_usage");
      // At least one token_usage event beyond the root turn's own — proves completeWithModel
      // reported its usage through the runtime's normal onEvent path, not silently.
      expect(tokenUsageEvents.length).toBeGreaterThanOrEqual(2);
      expect(
        tokenUsageEvents.every((e) => e.type === "token_usage" && e.agentId === ROOT_AGENT_ID),
      ).toBe(true);
    } finally {
      pageServer.stop(true);
    }
  });

  test("web.search configured with no web.fetch -> WebSearch is registered, WebFetch is not", async () => {
    const runtime = newAgentRuntime({
      config: baseConfig({
        web: { search: { provider: "brave", apiKey: "test-key" } },
      }),
      systemPrompt: "sp",
    });
    // Root just answers normally; the real assertion is that constructing/running a runtime
    // with only web.search configured doesn't throw or misbehave (WebSearch's own unit tests
    // in web-search.test.ts cover its execute() behavior in isolation).
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
  });
});
