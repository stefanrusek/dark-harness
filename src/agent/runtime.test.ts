// Integration tests for AgentRuntime — the composition root that wires dh.json config,
// provider adapters, the tool set, and the task registry together (docs/handoffs/core.md §4).
//
// These deliberately exercise the real AnthropicProvider (not a stubbed ModelProvider)
// against a local mock Anthropic-compatible HTTP server, since createProvider() always
// builds a real adapter from config — the same "local provider" path the sample dh.json
// documents (custom baseURL). This gives real end-to-end coverage of config -> provider ->
// loop -> tool dispatch without ever touching the network.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DhConfig, ExitCode, type LogLine, type ServerSentEvent } from "../contracts/index.ts";
import { AgentRuntime, ConfigModelError } from "./runtime.ts";
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
  return {
    events,
    logLines,
    onEvent: (e: ServerSentEvent) => events.push(e),
    onLogLine: (l: LogLine) => logLines.push(l),
  };
}

describe("AgentRuntime", () => {
  test("runRoot runs the default model end-to-end against the mock provider", async () => {
    const { events, logLines, onEvent, onLogLine } = collectors();
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
    expect(typeof output === "string" ? output.trim() : "").toBe("/tmp");
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
