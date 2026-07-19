// Integration tests for AgentRuntime — the composition root that wires dh.json config,
// provider adapters, the tool set, and the task registry together (docs/handoffs/core.md §4).
//
// These deliberately exercise the real AnthropicProvider (not a stubbed ModelProvider)
// against a local mock Anthropic-compatible HTTP server, since createProvider() always
// builds a real adapter from config — the same "local provider" path the sample dh.json
// documents (custom baseURL). This gives real end-to-end coverage of config -> provider ->
// loop -> tool dispatch without ever touching the network.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { SessionLogger } from "../server/index.ts";
import { ROOT_AGENT_ID } from "./agent-id.constant.ts";
import {
  AgentRuntime,
  type AgentRuntimeOptions,
  ConfigModelError,
  RootNotListeningError,
  RootOnlyModelSwitchError,
  UnknownSkillError,
} from "./runtime.ts";
import { bashTool } from "./tools/bash.ts";

/** Round 8: `AgentRuntimeOptions.client` is required (no default) so no real call site can
 * silently record a wrong value in a log header — but nearly every test in this suite
 * predates that field and doesn't care which value it takes. This helper defaults it to
 * `"none"` (the standalone/no-client value) so existing fixtures don't need to repeat it at
 * every call site; tests that specifically care about `client` still override it. */
/** Builds a fake Anthropic-shaped SSE streaming HTTP response (`text/event-stream`, one
 * `event:`/`data:` pair per raw stream event) from a whole-message content array + stop
 * reason — the same inputs the pre-DH-0044 non-streaming fixtures used, but encoded the way
 * `AnthropicProvider.complete()` now actually expects to decode them (see anthropic.ts's
 * `consumeAnthropicStream`, and `providers/anthropic.test.ts`'s `streamOf`/`textBlock`/
 * `toolUseBlock` helpers for the SDK-level equivalent of this same event shape). Centralizing
 * this here means every mock Anthropic HTTP server in this suite emits a real SSE body
 * instead of a single non-streaming JSON blob. */
function sseMessageResponse(
  contentBlocks: ReadonlyArray<
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input?: unknown }
  >,
  stopReason: string,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 5, output_tokens: 5 },
): Response {
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: "message_start",
      message: {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: "mock",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 0 },
      },
    },
  ];
  contentBlocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "", citations: null },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  });
  events.push({ type: "message_stop" });

  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

function newAgentRuntime(
  options: Omit<AgentRuntimeOptions, "client"> & Partial<Pick<AgentRuntimeOptions, "client">>,
) {
  return new AgentRuntime({ client: "none", ...options });
}

/** A minimal Anthropic Messages API-shaped mock server. Decides its response from the last
 * message's content, independent of call ordering, so it stays correct under the
 * concurrent sub-agent scenarios this suite exercises. */
function startMockAnthropicServer(
  onRequest?: (body: { model: string; system?: string; thinking?: unknown }) => void,
) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as {
        model: string;
        messages: { role: string; content: { type: string; text?: string }[] }[];
        thinking?: unknown;
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

      const message = (
        contentBlocks: Parameters<typeof sseMessageResponse>[0],
        stopReason: string,
      ): Response => sseMessageResponse(contentBlocks, stopReason);

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
        // DH-0091 test support: a keyword query that actually ranks the fixture .mcp.json
        // server's discovered tool into ToolSearch's (default top-5) results, unlike the
        // generic "q" query below.
        if (text.includes("use-toolsearch-project")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_search_project",
                name: "ToolSearch",
                input: { query: "fixture echo" },
              },
            ],
            "tool_use",
          );
        }
        if (
          text.includes("use-toolsearch") &&
          !text.includes("select-and-call") &&
          !text.includes("unreachable") &&
          !text.includes("project")
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
        // DH-0057 test support: drives the real `AgentRuntime.buildToolContext` ->
        // `ctx.mcpAuth.complete` facade (runtime.ts, not the tool-level mock used by
        // mcp-auth.test.ts) — calling `action: "complete"` for a server with no pending flow
        // still reaches that closure; McpManager.completeAuth() is the one that rejects it.
        if (text.includes("use-mcpauth-complete")) {
          return message(
            [
              {
                type: "tool_use",
                id: "tu_mcpauth_complete",
                name: "McpAuth",
                input: { server: "ghost", action: "complete" },
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
        // DH-0003 test support: the SendMessage-resume path's new turn, sent to an already-
        // finished sub-agent whose seeded history should carry the original "child
        // instruction"/"child done" turn ahead of this one.
        if (text === "resume: continue please") {
          return message([{ type: "text", text: "resumed done" }], "end_turn");
        }
        // DH-0050 note: checked against `firstText` (the conversation's original instruction),
        // not `text` (the latest message) — a non-tool-use, non-ReportOutcome turn now gets
        // one harness-injected "missed-call nudge" turn (loop.ts's REPORT_OUTCOME_NUDGE_MESSAGE)
        // before the legacy TASK_FAILED-marker fallback applies, so this branch must still
        // match and repeat the TASK_FAILED-marked reply on that follow-up turn, whose own
        // latest message is the nudge text, not "fail please".
        if (firstText.includes("fail please")) {
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
// DH-0094: (model, system prompt) pairs for every request the mock server saw — used to
// assert each agent's own resolved model produced its own per-agent self-info section.
let receivedSystemPrompts: { model: string; system?: string }[] = [];
// DH-0045: every request body's `thinking` field the mock server saw, in order — used to
// verify `ModelConfig.thinking` actually threads through runtime.ts -> loop.ts ->
// AnthropicProvider.complete() into the real wire request.
let receivedThinkingParams: unknown[] = [];

beforeAll(() => {
  server = startMockAnthropicServer((req) => {
    receivedModels.push(req.model);
    receivedSystemPrompts.push({
      model: req.model,
      ...(req.system !== undefined ? { system: req.system } : {}),
    });
    receivedThinkingParams.push(req.thinking);
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

  // DH-0094: self-awareness section (dh version/build, current model, sibling models) is
  // computed per-agent, not baked once into a shared systemPrompt string — a sub-agent may
  // run under a different ModelConfig than its parent/root, so it must see its *own* facts.
  test(
    "DH-0094: root and a sub-agent running a different model each get their own " +
      "per-agent self-info section in the system prompt sent to the provider",
    async () => {
      receivedSystemPrompts = [];
      const config = baseConfig({
        models: [
          { name: "test-model", provider: "mock", model: "mock-1" },
          { name: "other-model", provider: "mock", model: "mock-2" },
        ],
      });
      const runtime = newAgentRuntime({ config, systemPrompt: "you are a test agent" });

      const rootResult = await runtime.runRoot("please just answer", "test-model");
      expect(rootResult.success).toBe(true);

      const childTaskId = runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "other-model",
        prompt: "child instruction",
      });
      await runtime.tasks.awaitDone(childTaskId);

      const rootRequest = receivedSystemPrompts.find((r) => r.model === "mock-1");
      const childRequest = receivedSystemPrompts.find((r) => r.model === "mock-2");
      expect(rootRequest?.system).toContain("running as model config **test-model**");
      expect(rootRequest?.system).toContain("- **other-model** -> provider model `mock-2`");
      expect(childRequest?.system).toContain("running as model config **other-model**");
      expect(childRequest?.system).toContain("- **test-model** -> provider model `mock-1`");
      // Each agent's own config name must not appear in its own "other models" list.
      expect(rootRequest?.system).not.toContain("- **test-model** ->");
      expect(childRequest?.system).not.toContain("- **other-model** ->");
    },
  );

  // DH-0194: the standalone --job/--instructions path never sets `interactive` (defaults
  // false), so the agent must see the unattended-mode instructions in its system prompt.
  test("DH-0194: a non-interactive runtime (the default, matching --job) includes the job-mode section in the system prompt", async () => {
    receivedSystemPrompts = [];
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "you are a test agent" });
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
    expect(receivedSystemPrompts[0]?.system).toContain("You are running unattended (--job mode)");
    expect(receivedSystemPrompts[0]?.system).toContain(
      "Never ask a clarifying question and wait for a reply.",
    );
  });

  // DH-0194: interactive sessions (server/TUI/Web, `interactive: true`) have a live operator,
  // so the job-mode section must NOT be injected. Exercised via spawnAgent (not runRoot)
  // because an interactive root pauses "waiting" instead of resolving on its first
  // non-tool-use turn (Round 5 semantics, see AgentRuntimeOptions.interactive's doc comment)
  // — a sub-agent always reaches "done" regardless of the runtime's interactive flag (Round
  // 7 fix, see the test above), so it's the reliable way to await a system prompt here.
  test("DH-0194: an interactive runtime does not include the job-mode section in the system prompt", async () => {
    receivedSystemPrompts = [];
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "you are a test agent",
      interactive: true,
    });
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
    });
    await runtime.tasks.awaitDone(taskId);
    expect(runtime.tasks.snapshot(taskId).status).toBe("done");
    expect(receivedSystemPrompts[0]?.system).not.toContain(
      "You are running unattended (--job mode)",
    );
  });

  // DH-0215: the self-info section now also tells each agent its own sessionId, agentId,
  // and the real on-disk path to its own JSONL log file — verified against an actual
  // SessionLogger writing to a real tmp dir, so this proves the reported path is genuinely
  // readable and genuinely contains that agent's own transcript (not just a plausible-looking
  // string).
  test(
    "DH-0215: root and a sub-agent each see their own sessionId/agentId/log path in the " +
      "system prompt, and the reported path is a real, readable file containing that agent's " +
      "own transcript",
    async () => {
      receivedSystemPrompts = [];
      const dh215LogsRoot = mkdtempSync(join(tmpdir(), "dh-logs-runtime-dh0215-"));
      const sessionId = "session-dh-0215";
      const logger = new SessionLogger(join(dh215LogsRoot, sessionId));
      try {
        const runtime = newAgentRuntime({
          config: baseConfig(),
          systemPrompt: "you are a test agent",
          sessionId,
          logsRoot: dh215LogsRoot,
          onLogLine: (agentId, line) => logger.append(agentId, line),
        });

        const rootResult = await runtime.runRoot("please just answer", "test-model");
        expect(rootResult.success).toBe(true);

        const childTaskId = runtime.spawnAgent(ROOT_AGENT_ID, {
          model: "test-model",
          prompt: "child instruction",
        });
        await runtime.tasks.awaitDone(childTaskId);

        // Filter by this test's own sessionId rather than positional index — other tests'
        // background sub-agents may still be settling concurrently and pushing into the same
        // shared `receivedSystemPrompts` collector.
        const ownPrompts = receivedSystemPrompts.filter((r) =>
          r.system?.includes(`session id is \`${sessionId}\``),
        );
        const rootSystem = ownPrompts.find((r) =>
          r.system?.includes(`your own agent id is \`${ROOT_AGENT_ID}\``),
        )?.system;
        const childSystem = ownPrompts.find((r) =>
          r.system?.includes(`your own agent id is \`${childTaskId}\``),
        )?.system;
        expect(rootSystem).toContain(`session id is \`${sessionId}\``);
        expect(rootSystem).toContain(`your own agent id is \`${ROOT_AGENT_ID}\``);
        expect(childSystem).toContain(`session id is \`${sessionId}\``);
        expect(childSystem).toContain(`your own agent id is \`${childTaskId}\``);
        expect(rootSystem).not.toContain(`your own agent id is \`${childTaskId}\``);

        const rootLogPathMatch = rootSystem?.match(/logged automatically to `([^`]+)`/);
        const childLogPathMatch = childSystem?.match(/logged automatically to `([^`]+)`/);
        expect(rootLogPathMatch?.[1]).toBe(logger.filePathFor(ROOT_AGENT_ID));
        expect(childLogPathMatch?.[1]).toBe(logger.filePathFor(childTaskId));

        // The reported path is a real file — read it back and confirm it's genuinely that
        // agent's own transcript (header line naming its own agentId, plus event lines).
        const rootLogPath = rootLogPathMatch?.[1] ?? "";
        expect(existsSync(rootLogPath)).toBe(true);
        const rootLogLines = readFileSync(rootLogPath, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        expect(rootLogLines[0].type).toBe("header");
        expect(rootLogLines[0].agentId).toBe(ROOT_AGENT_ID);
        expect(rootLogLines.some((l) => l.type === "message")).toBe(true);

        const childLogPath = childLogPathMatch?.[1] ?? "";
        expect(existsSync(childLogPath)).toBe(true);
        const childLogLines = readFileSync(childLogPath, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        expect(childLogLines[0].type).toBe("header");
        expect(childLogLines[0].agentId).toBe(childTaskId);
      } finally {
        rmSync(dh215LogsRoot, { recursive: true, force: true });
      }
    },
  );

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

  // DH-0131: this is the "root agent failed to start" class of failure — resolveModel()/
  // providerFor() throwing synchronously before the loop ever runs. Confirmed live gap: this
  // used to only emit a `session_ended` ServerSentEvent (from a later catch block that didn't
  // even cover this synchronous-throw call site) — no `status_change` log line, no
  // `agent_status` SSE event at all. Fixed in runtime.ts's runRoot() by wrapping model/
  // provider resolution in the same try/catch as the loop itself.
  test("runRoot emits a status_change:failed log line and an agent_status:failed event when model resolution fails before the loop starts", async () => {
    const logLines: LogLine[] = [];
    const events: ServerSentEvent[] = [];
    const runtime = newAgentRuntime({
      config: baseConfig({
        provider: [{ name: "someone-else", type: "anthropic" }],
      }),
      systemPrompt: "sp",
      onLogLine: (_agentId, line) => logLines.push(line),
      onEvent: (event) => events.push(event),
    });
    await expect(runtime.runRoot("please just answer")).rejects.toThrow(ConfigModelError);
    expect(logLines.some((l) => l.type === "status_change" && l.status === "failed")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "agent_status" && e.agentId === ROOT_AGENT_ID && e.status === "failed",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "session_ended")).toBe(true);
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

  test("buildToolContext wires ctx.mcpAuth.complete so the McpAuth tool can drive it", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });
    const result = await runtime.runRoot("use-mcpauth-complete");
    expect(result.success).toBe(true);
    const toolResult = logLines.find(
      (l) => l.type === "tool_result" && l.toolUseId === "tu_mcpauth_complete",
    );
    // No pending flow for "ghost" (not even a configured server) — McpManager.completeAuth()
    // rejects with McpAuthConfigError, which the tool reports informationally, not as a
    // harness failure. The point of this test is that ctx.mcpAuth.complete() was reached at
    // all through the real runtime wiring, not the mocked facade mcp-auth.test.ts uses.
    expect(toolResult && toolResult.type === "tool_result" ? toolResult.output : "").toContain(
      'Unknown MCP server "ghost"',
    );
  });

  test("buildToolContext wires searchDeferredTools so the ToolSearch tool can query it", async () => {
    const runtime = newAgentRuntime({
      // Deliberately unreachable (nothing listens on 127.0.0.1:1) rather than a real
      // internet host — this test only cares that the wiring itself works, not that the
      // configured MCP server ever actually connects, so it shouldn't make a real outbound
      // network call. A prior "https://example.com" here did (McpManager's connectAll()
      // eagerly attempts a real streamable-HTTP POST), a stray real network hit noticed
      // while chasing the post-DH-0044 mock breakage — separate root cause, fixed here.
      config: baseConfig({ mcpServers: { docs: { url: "http://127.0.0.1:1" } } }),
      systemPrompt: "sp",
    });
    const result = await runtime.runRoot("use-toolsearch");
    expect(result.success).toBe(true);
  });

  test(
    "DH-0002: select: activates a real MCP tool discovered from a configured stdio " +
      "server, and the very next turn can call it and get real output back",
    async () => {
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
    },
  );

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

  test(
    "DH-0002: AgentRuntime.close() closes the shared McpManager (terminates stdio " +
      "children) without throwing, even with no mcpServers configured",
    async () => {
      const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
      await expect(runtime.close()).resolves.toBeUndefined();
    },
  );

  describe("DH-0091: project .mcp.json auto-load", () => {
    const fixturePath = fileURLToPath(
      new URL("./mcp/__fixtures__/fake-stdio-server.ts", import.meta.url),
    );

    function tempProjectDir(mcpJsonContents?: string): string {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "dh-runtime-mcp-")));
      if (mcpJsonContents !== undefined) {
        writeFileSync(join(dir, ".mcp.json"), mcpJsonContents);
      }
      return dir;
    }

    test("no .mcp.json present in cwd — behavior is unchanged, no error", async () => {
      const dir = tempProjectDir();
      const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", cwd: dir });
      const result = await runtime.runRoot("please just answer");
      expect(result.success).toBe(true);
      await runtime.close();
    });

    test("a .mcp.json server is merged into the runtime's MCP tool set", async () => {
      const { logLines, onLogLine } = collectors();
      const dir = tempProjectDir(
        JSON.stringify({
          mcpServers: { fixture: { command: process.execPath, args: ["run", fixturePath] } },
        }),
      );
      const runtime = newAgentRuntime({
        config: baseConfig(),
        systemPrompt: "sp",
        cwd: dir,
        onLogLine,
      });
      // Let the fire-and-forget .mcp.json read + connect settle before ToolSearch runs.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await runtime.runRoot("use-toolsearch-project");
      expect(result.success).toBe(true);
      const searchResult = logLines.find(
        (l) => l.type === "tool_result" && l.toolUseId === "tu_search_project",
      );
      const output = searchResult && searchResult.type === "tool_result" ? searchResult.output : "";
      expect(output).toContain("mcp__fixture__echo");
      await runtime.close();
    });

    test("on a name collision, dh.json's own mcpServers entry wins over .mcp.json's", async () => {
      const dir = tempProjectDir(
        JSON.stringify({
          mcpServers: { shared: { command: process.execPath, args: ["run", fixturePath] } },
        }),
      );
      const { logLines, onLogLine } = collectors();
      const runtime = newAgentRuntime({
        config: baseConfig({
          mcpServers: { shared: { command: "/definitely/does/not/exist/mcp-server" } },
        }),
        systemPrompt: "sp",
        cwd: dir,
        onLogLine,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await runtime.runRoot("use-toolsearch-project");
      expect(result.success).toBe(true);
      const searchResult = logLines.find(
        (l) => l.type === "tool_result" && l.toolUseId === "tu_search_project",
      );
      const output = searchResult && searchResult.type === "tool_result" ? searchResult.output : "";
      // dh.json's own ("shared" -> broken command) definition must win: the .mcp.json fixture
      // server's tool never gets discovered, and the server shows up as unreachable instead.
      expect(output).not.toContain("mcp__shared__echo");
      expect(output).toContain("shared");
      expect(output).toContain("Unreachable");
      await runtime.close();
    });

    test("a malformed .mcp.json logs a clear error and does not crash startup", async () => {
      const dir = tempProjectDir("{ not valid json");
      const originalConsoleError = console.error;
      const errors: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      try {
        const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", cwd: dir });
        const result = await runtime.runRoot("please just answer");
        expect(result.success).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(errors.some((a) => String(a[0]).includes(".mcp.json"))).toBe(true);
        await runtime.close();
      } finally {
        console.error = originalConsoleError;
      }
    });
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

  test(
    "DH-0070: each concurrently-spawned sub-agent sees its own agent's cwd, not " +
      "another agent's or the process's — per-agent cwd is captured at spawn time, not read " +
      "from one shared runtime-wide field",
    async () => {
      // Three genuinely-distinct real directories: one per runtime, plus one the *process*
      // is chdir'd into below. They must never collide, or the assertions contradict each
      // other. The old code used realpathSync("/tmp") for dirA, which is fine on macOS (where
      // /tmp is a symlink to /private/tmp, so it differs from tmpdir()) but on Linux CI
      // realpathSync("/tmp") === tmpdir() === "/tmp", making dirA === the process cwd — so
      // "sees its own cwd" (== dirA) and "never sees the process cwd" (!= tmpdir) became
      // mutually exclusive and the test failed only in CI. Using fresh mkdtemp dirs for all
      // three removes that platform-dependent collision entirely.
      const dirA = realpathSync(mkdtempSync(join(tmpdir(), "dh-cwd-a-")));
      const dirB = realpathSync(mkdtempSync(join(tmpdir(), "dh-cwd-b-")));
      const procDir = realpathSync(mkdtempSync(join(tmpdir(), "dh-cwd-proc-")));
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
      process.chdir(procDir);
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
      expect(pwdOutput(logLinesA)).not.toBe(procDir);
      expect(pwdOutput(logLinesB)).not.toBe(procDir);
    },
  );

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
    // tree is agent-kind only). `background: false` on both tasks below: this test is only
    // about tree structure/bash-vs-agent filtering, not completion notifications; since
    // DH-0140, a *background* completion notification reaching an unstarted root now lazily
    // (re)starts it (deliverOrResumeAgent()), which would give this root a real
    // "running"/"done" status and break the "waiting" assertion further down. `background:
    // false` never fires that notification path at all (see StartTaskParams.background's own
    // doc comment).
    runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      background: false,
      run: async () => {},
    });
    const childTaskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
      background: false,
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

  // DH-0207/DH-0208: cancelQueuedMessage() root-vs-sub-agent split.
  test("cancelQueuedMessage(ROOT_AGENT_ID, ...) returns false before the root has started (nothing queued, nothing to cancel)", () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    expect(runtime.cancelQueuedMessage(ROOT_AGENT_ID, "whatever")).toBe(false);
  });

  test("cancelQueuedMessage(ROOT_AGENT_ID, ...) removes a still-queued entry from a live root, returning false for an unknown id", async () => {
    let queuedId: string | undefined;
    const runtime = newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      onEvent: (event) => {
        if (event.type === "agent_queue" && event.agentId === ROOT_AGENT_ID) {
          queuedId = event.queue[0]?.id;
        }
      },
    });
    const rootPromise = runtime.runRoot("please just answer");
    // sendMessageToRoot's own sibling test above already establishes this synchronous-window
    // ordering is safe (the sink is registered before the first `await` inside runAgentLoop).
    runtime.sendMessageToRoot("cancel target");
    expect(queuedId).toBeDefined();
    expect(runtime.cancelQueuedMessage(ROOT_AGENT_ID, "not-a-real-id")).toBe(false);
    expect(queuedId !== undefined && runtime.cancelQueuedMessage(ROOT_AGENT_ID, queuedId)).toBe(
      true,
    );
    const result = await rootPromise;
    expect(result.success).toBe(true);
  });

  test("cancelQueuedMessage against a non-root agentId delegates to TaskRegistry", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
    });
    // registerCancelQueuedMessage is installed synchronously at the top of runAgentLoop,
    // before its first await — safe to call immediately, mirroring sendMessage()'s own
    // precedent (see the "SendMessage injection" test in loop.test.ts).
    expect(runtime.cancelQueuedMessage(taskId, "not-a-real-id")).toBe(false);
    await runtime.tasks.awaitDone(taskId);
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
        // DH-0050: the second turn calls ReportOutcome directly (a real model's expected
        // behavior) rather than ending its turn with plain text — that lets the loop's tier-1
        // authoritative-ReportOutcome check end the run right here, in exactly the 2 calls
        // this test asserts on. Ending with plain text/end_turn instead would have hit tier
        // 2's missed-call nudge (loop.ts's REPORT_OUTCOME_NUDGE_MESSAGE), silently adding a
        // 3rd request this test doesn't expect.
        return sseMessageResponse(
          isFirstCall
            ? [
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "Bash",
                  input: { command: "echo hi", run_in_background: false },
                },
              ]
            : [
                {
                  type: "tool_use",
                  id: "tu_report",
                  name: "ReportOutcome",
                  input: { status: "success", summary: "done" },
                },
              ],
          "tool_use",
          { input_tokens: 1, output_tokens: 1 },
        );
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
        return sseMessageResponse(
          [{ type: "text", text: `seen so far: ${seenTexts.join(" | ")}` }],
          "end_turn",
          { input_tokens: 1, output_tokens: 1 },
        );
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

describe("AgentRuntime — DH-0045: extended thinking threads from config to the real provider request", () => {
  test("a configured ModelConfig.thinking reaches the real wire request body", async () => {
    receivedThinkingParams = [];
    const { onEvent } = collectors();
    const runtime = newAgentRuntime({
      config: baseConfig({
        models: [
          {
            name: "test-model",
            provider: "mock",
            model: "mock-1",
            thinking: { type: "enabled", budgetTokens: 2048, display: "summarized" },
          },
        ],
      }),
      systemPrompt: "sp",
      onEvent,
    });
    await runtime.runRoot("please just answer");
    expect(receivedThinkingParams.length).toBeGreaterThan(0);
    expect(receivedThinkingParams[0]).toEqual({
      type: "enabled",
      budget_tokens: 2048,
      display: "summarized",
    });
  });

  test("an unconfigured model sends no thinking param at all (no regression)", async () => {
    receivedThinkingParams = [];
    const { onEvent } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    await runtime.runRoot("please just answer");
    expect(receivedThinkingParams.length).toBeGreaterThan(0);
    expect(receivedThinkingParams[0]).toBeUndefined();
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

  // DH-0010 Part A fix: the cumulative token count must include cache-read/cache-write
  // tokens, not just input+output — otherwise enabling caching would silently inflate
  // maxTotalTokens's effective budget.
  test("maxTotalTokens counts cache-read/cache-write tokens toward the cap, not just input+output", async () => {
    // A dedicated mock server that always answers with a looping tool_use turn (so nothing
    // but the budget can end the run) whose usage carries mostly cache tokens — input+output
    // alone (2 total) would never reach a cap of 10 within a reasonable number of turns, but
    // the 8 cache tokens reported per turn do.
    const cacheServer = Bun.serve({
      port: 0,
      fetch() {
        const events = [
          {
            type: "message_start",
            message: {
              id: "msg_mock",
              type: "message",
              role: "assistant",
              model: "mock",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 1,
                output_tokens: 0,
                cache_read_input_tokens: 5,
                cache_creation_input_tokens: 3,
              },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tu_loop", name: "Bash", input: {} },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify({ command: "true", run_in_background: false }),
            },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ];
        const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const { onLogLine, logLines } = collectors();
      const runtime = newAgentRuntime({
        config: baseConfig({
          options: { defaultModel: "test-model", maxTotalTokens: 10 },
          provider: [
            {
              name: "mock",
              type: "anthropic",
              baseURL: cacheServer.url.toString(),
              apiKey: "sk-test",
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
          (l) =>
            l.type === "message" && l.role === "system" && l.content.includes("maxTotalTokens"),
        ),
      ).toBe(true);
    } finally {
      cacheServer.stop(true);
    }
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

  test(
    "DH-0077: isolation: 'worktree' points the sub-agent's cwd at a fresh worktree, " +
      "auto-cleaned up when it has no changes",
    async () => {
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
    },
  );

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

  // DH-0140: a grandchild whose parent has already finished used to have its completion
  // notification dropped (log-only, "could NOT be delivered live"). handleTaskSettled() now
  // routes through the same resume-capable path sendMessage()/DH-0003 uses, so the finished
  // parent is resumed with the notification as its next instruction instead.
  test("orphaned grandchild: if the parent has already finished, the notification resumes it instead of being lost", async () => {
    let logsRoot: string | undefined;
    try {
      logsRoot = mkdtempSync(join(tmpdir(), "dh-logs-runtime-orphaned-grandchild-"));
      const sessionId = "session-orphaned-grandchild";
      const logger = new SessionLogger(join(logsRoot, sessionId));
      const { logLines, onLogLine } = collectors();
      const runtime = newAgentRuntime({
        config: baseConfig(),
        systemPrompt: "sp",
        sessionId,
        logsRoot,
        onLogLine: (agentId, line) => {
          logger.append(agentId, line);
          onLogLine(agentId, line);
        },
      });

      // A real sub-agent (spawnAgent(), so it has a real JSONL log to resume from), which
      // itself finishes before its own background grandchild does — the exact edge case the
      // handoff raised directly.
      const parentId = runtime.spawnAgent(ROOT_AGENT_ID, {
        model: "test-model",
        prompt: "child instruction",
      });
      await runtime.tasks.awaitDone(parentId);
      expect(runtime.tasks.snapshot(parentId).status).toBe("done");

      const childId = runtime.tasks.start({
        kind: "bash",
        parentAgentId: parentId,
        background: true,
        run: async () => {},
      });
      await runtime.tasks.awaitDone(childId);

      // The parent (same task id) is live again, resumed with the notification as its next
      // instruction — not the old "could NOT be delivered live" drop.
      expect(runtime.tasks.trySnapshot(parentId)?.status).not.toBe("done");
      const notice = logLines.find(
        (l) =>
          l.type === "message" &&
          l.role === "system" &&
          l.content.includes("Background Bash task") &&
          l.content.includes("delivered via resume"),
      );
      expect(notice).toBeDefined();

      await runtime.tasks.awaitDone(parentId);
    } finally {
      if (logsRoot) rmSync(logsRoot, { recursive: true, force: true });
    }
  });

  // DH-0140: a completion notification arriving for the root before/after it has ever run
  // used to be silently dropped ("could NOT be delivered live"). handleTaskSettled() now
  // lazily (re)starts the root with the notification as its instruction, mirroring
  // invokeSkill()'s own root-lazy-start convention.
  test("a background task's completion lazily (re)starts a root that hasn't started yet, instead of being dropped", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });

    expect(runtime.rootHasStarted).toBe(false);

    const childId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      background: true,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(childId);

    expect(runtime.rootHasStarted).toBe(true);
    const notice = logLines.find(
      (l) =>
        l.type === "message" && l.role === "system" && l.content.includes("Background Bash task"),
    );
    expect(notice).toBeDefined();
    if (notice?.type === "message") {
      expect(notice.content).toContain("delivered via resume");
    }

    // Let the lazily-started root's own turn actually finish before the test ends, so it
    // doesn't leak an in-flight fetch/timer into the next test. Root loop invocations never
    // emit "status_change" log lines (that's a sub-agent-only marker — see loop.ts's
    // `isSubAgent` guard); getAgentTree()'s rootStatus is what actually reflects it.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && runtime.getAgentTree()[0]?.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(runtime.getAgentTree()[0]?.status).not.toBe("running");
  });

  // DH-0140 User Story: a late child notification arriving after the root's own session has
  // already concluded resumes it, exactly as the not-yet-started case above does — not
  // silently dropped.
  test("a background task's completion resumes the root after its own session has already concluded", async () => {
    const { logLines, onLogLine } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onLogLine });

    await runtime.runRoot("root done please");
    expect(runtime.rootHasStarted).toBe(true);
    expect(runtime.getAgentTree()[0]?.status).not.toBe("running");

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
      expect(notice.content).toContain("delivered via resume");
    }

    // Let the resumed root's own turn actually finish before the test ends (see the previous
    // test's comment on why rootStatus, not a "status_change" log line, is the right signal).
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && runtime.getAgentTree()[0]?.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(runtime.getAgentTree()[0]?.status).not.toBe("running");
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

  test(
    "web.fetch configured -> WebFetch actually runs end-to-end, and its extraction-model " +
      "call (completeWithModel) feeds the same token_usage/session-accounting path as a normal turn",
    async () => {
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
    },
  );

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

// DH-0093: backend support for the slash-command system (model switching, skill invocation).
describe("AgentRuntime.listModels/switchModel (DH-0093)", () => {
  function twoModelConfig(): DhConfig {
    return baseConfig({
      models: [
        { name: "test-model", provider: "mock", model: "mock-1" },
        { name: "other-model", provider: "mock", model: "mock-2" },
      ],
    });
  }

  test("listModels() maps config.models into wire ModelInfo[], marking the default and the root's currently-active model", () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    expect(runtime.listModels()).toEqual([
      {
        name: "test-model",
        provider: "mock",
        model: "mock-1",
        isDefault: true,
        isActive: true,
      },
      {
        name: "other-model",
        provider: "mock",
        model: "mock-2",
        isDefault: false,
        isActive: false,
      },
    ]);
  });

  test("listModels() reflects the active model after runRoot() ran with a non-default model", async () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    await runtime.runRoot("please just answer", "other-model");
    const models = runtime.listModels();
    expect(models.find((m) => m.name === "other-model")?.isActive).toBe(true);
    expect(models.find((m) => m.name === "test-model")?.isActive).toBe(false);
  });

  test("switchModel() rejects a non-root agentId with RootOnlyModelSwitchError", () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    expect(() => runtime.switchModel("agent-some-child", "other-model")).toThrow(
      RootOnlyModelSwitchError,
    );
  });

  test("switchModel() propagates ConfigModelError for an unknown model alias", () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    expect(() => runtime.switchModel(ROOT_AGENT_ID, "nope")).toThrow(ConfigModelError);
  });

  test("switchModel() before the root has started records a pending initial model that runRoot() then uses, and updates rootModel/getAgentTree() immediately", async () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    runtime.switchModel(ROOT_AGENT_ID, "other-model");
    // Reflected immediately, before the root has even started.
    expect(runtime.getAgentTree()[0]?.model).toBe("other-model");

    receivedModels = [];
    const result = await runtime.runRoot("please just answer");
    expect(result.success).toBe(true);
    // runRoot() with no explicit modelName argument honored the pending switch over
    // options.defaultModel.
    expect(receivedModels).toContain("mock-2");
    expect(receivedModels).not.toContain("mock-1");
  });

  test("an explicit runRoot() modelName argument still wins over a pending switch", async () => {
    const runtime = newAgentRuntime({ config: twoModelConfig(), systemPrompt: "sp" });
    runtime.switchModel(ROOT_AGENT_ID, "other-model");
    receivedModels = [];
    const result = await runtime.runRoot("please just answer", "test-model");
    expect(result.success).toBe(true);
    expect(receivedModels).toContain("mock-1");
  });

  test("switchModel() while the root is live pushes a new binding into the running loop's next turn, and updates rootModel/getAgentTree() immediately", async () => {
    const requestBodies: { model: string }[] = [];
    const dedicatedServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { model: string };
        requestBodies.push(body);
        const isFirstCall = requestBodies.length === 1;
        return sseMessageResponse(
          isFirstCall
            ? [
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "Bash",
                  input: { command: "echo hi", run_in_background: false },
                },
              ]
            : [{ type: "text", text: "done" }],
          isFirstCall ? "tool_use" : "end_turn",
          { input_tokens: 1, output_tokens: 1 },
        );
      },
    });
    try {
      const runtime = newAgentRuntime({
        config: baseConfig({
          models: [
            { name: "test-model", provider: "mock", model: "mock-1" },
            { name: "other-model", provider: "mock", model: "mock-2" },
          ],
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
      // registerModelSwitch's sink is installed synchronously at the top of runAgentLoop, so
      // this is safe to call right away — it lands in time for turn 2's request.
      runtime.switchModel(ROOT_AGENT_ID, "other-model");
      expect(runtime.getAgentTree()[0]?.model).toBe("other-model");
      const result = await rootPromise;
      expect(result.success).toBe(true);
      expect(requestBodies[1]?.model).toBe("mock-2");
    } finally {
      dedicatedServer.stop(true);
    }
  });
});

describe("AgentRuntime.listSkills/invokeSkill (DH-0093)", () => {
  test("listSkills() includes the builtin cli-tools entry even with no skillPaths configured", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    const skills = await runtime.listSkills();
    expect(skills.some((s) => s.name === "cli-tools" && s.description.length > 0)).toBe(true);
  });

  test("listSkills() includes an on-disk skillPaths skill alongside the builtin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-runtime-skills-"));
    const { mkdirSync, writeFileSync: writeFile } = await import("node:fs");
    mkdirSync(join(dir, "reviewer"));
    writeFile(
      join(dir, "reviewer", "SKILL.md"),
      '---\nname: reviewer\ndescription: "Reviews things."\n---\n\nDo a review.',
    );
    const runtime = newAgentRuntime({
      config: baseConfig({ skillPaths: [dir] }),
      systemPrompt: "sp",
    });
    // DH-0165: listSkills() itself now awaits the eager discoverSkills() scan's completion
    // (see runtime.ts's `skillsReady` field) — no more fixed-delay poll needed here, and this
    // is exactly the real-world race that fix closes: a caller that asks before the scan
    // resolves used to see only the builtin entry.
    const skills = await runtime.listSkills();
    expect(skills.some((s) => s.name === "cli-tools")).toBe(true);
    expect(skills.some((s) => s.name === "reviewer" && s.description === "Reviews things.")).toBe(
      true,
    );
  });

  test("invokeSkill() throws UnknownSkillError for a skill name that can't be found", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    await expect(runtime.invokeSkill(ROOT_AGENT_ID, "nope-not-real", undefined)).rejects.toThrow(
      UnknownSkillError,
    );
  });

  test("invokeSkill() against the root before it has started lazily starts it with the composed invocation as the instruction", async () => {
    const { events, onEvent } = collectors();
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp", onEvent });
    await runtime.invokeSkill(ROOT_AGENT_ID, "cli-tools", "some args");
    // Fire-and-forget lazy start — wait for the root to actually finish.
    while (!events.some((e) => e.type === "session_ended")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(runtime.getAgentTree()[0]?.status).not.toBe("waiting");
  });

  test("invokeSkill() against an already-running root delivers the composed message via sendMessageToRoot", async () => {
    const requestBodies: { messages: { content: { type: string; text?: string }[] }[] }[] = [];
    const dedicatedServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          messages: { content: { type: string; text?: string }[] }[];
        };
        requestBodies.push(body);
        const isFirstCall = requestBodies.length === 1;
        return sseMessageResponse(
          isFirstCall
            ? [
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "Bash",
                  input: { command: "echo hi", run_in_background: false },
                },
              ]
            : [{ type: "text", text: "done" }],
          isFirstCall ? "tool_use" : "end_turn",
          { input_tokens: 1, output_tokens: 1 },
        );
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
      await runtime.invokeSkill(ROOT_AGENT_ID, "cli-tools", "my args");
      const result = await rootPromise;
      expect(result.success).toBe(true);
      const secondRequest = requestBodies[1];
      const sawComposed = secondRequest?.messages.some((m) =>
        m.content.some(
          (c) =>
            c.type === "text" &&
            c.text?.includes("<command-name>/cli-tools</command-name>") &&
            c.text?.includes("<command-args>my args</command-args>"),
        ),
      );
      expect(sawComposed).toBe(true);
    } finally {
      dedicatedServer.stop(true);
    }
  });

  test("invokeSkill() against a sub-agent task delivers via tasks.sendMessage", async () => {
    const runtime = newAgentRuntime({ config: baseConfig(), systemPrompt: "sp" });
    // spawnAgent() with a prompt that keeps calling a tool forever, so the task stays live
    // long enough for invokeSkill() to actually reach tasks.sendMessage() rather than racing
    // its natural completion.
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "loop-forever",
    });
    await runtime.invokeSkill(taskId, "cli-tools", undefined);
    runtime.tasks.stop(taskId);
    await runtime.tasks.awaitDone(taskId).catch(() => {});
  });
});

describe("AgentRuntime.sendMessage — DH-0003: resuming a finished sub-agent's conversation", () => {
  let logsRoot: string | undefined;

  afterEach(() => {
    if (logsRoot) rmSync(logsRoot, { recursive: true, force: true });
    logsRoot = undefined;
  });

  /** Builds a runtime wired the same way the real `src/cli.ts` call sites wire one — a real
   * `SessionLogger` writing into a fresh tmpdir `.dh-logs` root, with `sessionId`/`logsRoot`
   * both explicit — so `AgentRuntime.sendMessage()`'s `reconstructSubAgentHistory()` call
   * reads back real JSONL files, the same way it will in production. */
  function newLoggedRuntime(): AgentRuntime {
    logsRoot = mkdtempSync(join(tmpdir(), "dh-logs-runtime-sendmessage-"));
    const sessionId = "session-resume-test";
    const logger = new SessionLogger(join(logsRoot, sessionId));
    return newAgentRuntime({
      config: baseConfig(),
      systemPrompt: "sp",
      sessionId,
      logsRoot,
      onLogLine: (agentId, line) => logger.append(agentId, line),
    });
  }

  test("SendMessage to a done sub-agent resumes it under the same task id, seeded with its prior history", async () => {
    const runtime = newLoggedRuntime();
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "child instruction",
      description: "Child",
    });
    await runtime.tasks.awaitDone(taskId);
    expect(runtime.tasks.snapshot(taskId).status).toBe("done");

    runtime.sendMessage(taskId, "resume: continue please");
    // sendMessage() re-invokes spawnAgent() synchronously (before its async `run` resolves),
    // so the task is live again under the very same id immediately.
    expect(runtime.tasks.trySnapshot(taskId)?.status).not.toBe("done");
    await runtime.tasks.awaitDone(taskId);

    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.id).toBe(taskId);
    expect(snapshot.status).toBe("done");
    expect(snapshot.output).toContain("resumed done");
    // Reused the same description too (spawnAgent's params carried it through from the
    // finished snapshot, not lost on resume).
    expect(snapshot.description).toBe("Child");

    // The reused id's JSONL log file now holds both the original run (header + "child
    // instruction"/"child done") and the resumed run (a second header + "resume: continue
    // please"/"resumed done") — proof this was the SAME agent identity resuming, not a fresh
    // one, and that the seeded history actually came from this file.
    // biome-ignore lint/style/noNonNullAssertion: set by newLoggedRuntime() above
    const logPath = join(logsRoot!, "session-resume-test", `${encodeURIComponent(taskId)}.jsonl`);
    const raw = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const headers = raw.filter((l) => l.type === "header");
    expect(headers).toHaveLength(2);
    const userTexts = raw
      .filter((l) => l.type === "message" && l.role === "user")
      .map((l) => l.content);
    expect(userTexts).toContain("child instruction");
    expect(userTexts).toContain("resume: continue please");
  });

  test("SendMessage to a failed sub-agent resumes it identically to a done one (no special-casing)", async () => {
    const runtime = newLoggedRuntime();
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "fail please",
    });
    await runtime.tasks.awaitDone(taskId);
    expect(runtime.tasks.snapshot(taskId).status).toBe("failed");

    runtime.sendMessage(taskId, "resume: continue please");
    await runtime.tasks.awaitDone(taskId);

    // Resumed history still starts with the original "fail please" instruction (D6: resume
    // never rewrites prior turns), so the mock's TASK_FAILED-marker fallback fires again on
    // this run's own missed-call nudge — the resumed run reprocesses "resume: continue
    // please" (proving it actually saw the new message) before that happens.
    const snapshot = runtime.tasks.snapshot(taskId);
    expect(snapshot.id).toBe(taskId);
    expect(snapshot.status).toBe("failed");
    expect(snapshot.output).toContain("resumed done");
  });

  test("SendMessage to a bash-kind finished task still throws TaskFinishedError (no conversation to resume)", async () => {
    const runtime = newLoggedRuntime();
    const taskId = runtime.tasks.start({
      kind: "bash",
      parentAgentId: ROOT_AGENT_ID,
      run: async () => {},
    });
    await runtime.tasks.awaitDone(taskId);
    expect(() => runtime.sendMessage(taskId, "hi")).toThrow(/already finished/);
  });

  test("SendMessage to a still-running sub-agent delivers normally, no resume path taken", async () => {
    const runtime = newLoggedRuntime();
    const taskId = runtime.spawnAgent(ROOT_AGENT_ID, {
      model: "test-model",
      prompt: "loop-forever",
    });
    // Doesn't throw, doesn't go through the resume path (the task is still live).
    expect(() => runtime.sendMessage(taskId, "steer this way")).not.toThrow();
    runtime.tasks.stop(taskId);
    await runtime.tasks.awaitDone(taskId).catch(() => {});
  });
});
