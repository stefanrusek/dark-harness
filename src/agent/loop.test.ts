import { describe, expect, test } from "bun:test";
import type { LogLine, ServerSentEvent } from "../contracts/index.ts";
import { TASK_FAILED_MARKER, runAgentLoop } from "./loop.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from "./providers/types.ts";
import { buildToolMap } from "./tools/index.ts";
import { makeToolContext } from "./tools/test-helpers.ts";

/** A scripted fake provider: each call to complete() returns the next entry in `script`. */
function scriptedProvider(
  script: ProviderCompletionResult[],
): ModelProvider & { calls: ProviderCompletionRequest[] } {
  const calls: ProviderCompletionRequest[] = [];
  let i = 0;
  return {
    calls,
    async complete(request) {
      // loop.ts mutates the same `messages` array across turns; snapshot it so each call's
      // recorded request reflects what the provider actually saw at call time.
      calls.push({ ...request, messages: [...request.messages] });
      const result = script[i];
      i += 1;
      if (!result) throw new Error("scriptedProvider: ran out of scripted responses");
      return result;
    },
  };
}

function baseParams(overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {}) {
  const events: ServerSentEvent[] = [];
  const logLines: LogLine[] = [];
  const toolContext = makeToolContext();
  return {
    events,
    logLines,
    params: {
      sessionId: "session-1",
      agentId: "agent-root",
      parentAgentId: null,
      model: "sonnet",
      systemPrompt: "you are a test agent",
      instruction: "do the thing",
      tools: buildToolMap(),
      toolContext,
      onEvent: (e: ServerSentEvent) => events.push(e),
      onLogLine: (l: LogLine) => logLines.push(l),
      ...overrides,
    } as Parameters<typeof runAgentLoop>[0],
  };
}

describe("runAgentLoop", () => {
  test("a scripted exchange with one tool call then completion reports success", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "Bash",
            input: { command: "echo hi", run_in_background: false },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "All done, task succeeded." }],
        usage: { inputTokens: 12, outputTokens: 6 },
      },
    ]);
    const { params, events, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("All done, task succeeded.");
    expect(result.turns).toBe(2);

    // Events shaped per src/contracts/events.ts
    expect(events.some((e) => e.type === "agent_spawned")).toBe(true);
    expect(events.some((e) => e.type === "agent_output" && e.chunk.includes("All done"))).toBe(
      true,
    );
    expect(events.some((e) => e.type === "token_usage")).toBe(true);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe("done");

    // Log lines shaped per src/contracts/log.ts
    expect(logLines[0]?.type).toBe("header");
    expect(logLines.some((l) => l.type === "tool_call" && l.toolName === "Bash")).toBe(true);
    expect(logLines.some((l) => l.type === "tool_result")).toBe(true);
    expect(logLines.some((l) => l.type === "completed")).toBe(true);

    // The tool_result was fed back to the provider on the second call.
    expect(provider.calls[1]?.messages.at(-1)?.content[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_1",
    });
  });

  test("TASK_FAILED marker in the final text reports self-reported failure", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: `I could not finish. ${TASK_FAILED_MARKER}` }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(false);
    expect(logLines.some((l) => l.type === "failed" && l.reason.includes("TASK_FAILED"))).toBe(
      true,
    );
  });

  test("max_tokens on a non-tool-use turn is always treated as failure", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "max_tokens",
        content: [{ type: "text", text: "still going..." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(false);
  });

  test("unknown tool name in a tool_use block reports an error result without throwing", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "NotARealTool", input: {} }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    const toolResultLog = logLines.find((l) => l.type === "tool_result");
    expect(toolResultLog && toolResultLog.type === "tool_result" && toolResultLog.isError).toBe(
      true,
    );
  });

  test("exceeding maxTurns reports failure without throwing", async () => {
    const provider: ModelProvider = {
      async complete() {
        return {
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_x",
              name: "Bash",
              input: { command: "echo x", run_in_background: false },
            },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const { params } = baseParams({ provider, maxTurns: 2 });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(false);
    expect(result.turns).toBe(2);
  });

  test("SendMessage injection is picked up as a user turn before the next completion", async () => {
    let sendFn: ((message: string) => void) | undefined;
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "Bash",
            input: { command: "echo first", run_in_background: false },
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({
      provider,
      registerSendMessage: (fn: (message: string) => void) => {
        sendFn = fn;
      },
    });
    // Deliver the message before the loop starts its second turn — the loop registers the
    // sink synchronously at the top of runAgentLoop, so this is safe to call right away.
    const resultPromise = runAgentLoop(params);
    sendFn?.("steer towards X");
    const result = await resultPromise;
    expect(result.success).toBe(true);
    const secondCallMessages = provider.calls[1]?.messages ?? [];
    const hasInjected = secondCallMessages.some((m) =>
      m.content.some((c) => c.type === "text" && c.text.includes("steer towards X")),
    );
    expect(hasInjected).toBe(true);
  });
});
