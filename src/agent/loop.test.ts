import { describe, expect, test } from "bun:test";
import type { LogLine, ServerSentEvent } from "../contracts/index.ts";
import {
  STOPPED_BETWEEN_TURNS_REASON,
  STOPPED_DURING_PROVIDER_CALL_REASON,
  TASK_FAILED_MARKER,
  runAgentLoop,
} from "./loop.ts";
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

describe("runAgentLoop — Round 3: cooperative cancellation via AbortSignal", () => {
  test("an already-aborted signal stops before the first turn, without ever calling the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    let providerCalled = false;
    const provider: ModelProvider = {
      async complete() {
        providerCalled = true;
        return {
          stopReason: "end_turn",
          content: [{ type: "text", text: "should not happen" }],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const { params, events, logLines } = baseParams({ provider, signal: controller.signal });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(false);
    expect(result.turns).toBe(0);
    expect(result.finalOutput).toBe("");
    expect(providerCalled).toBe(false);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe("failed");
    expect(
      logLines.some((l) => l.type === "failed" && l.reason === STOPPED_BETWEEN_TURNS_REASON),
    ).toBe(true);
  });

  test("a signal aborted mid-flight (after turn 1 starts, before turn 2) stops before the next turn — the actual TaskStop/stopAgent path", async () => {
    const controller = new AbortController();
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          { type: "text", text: "partial thought" },
          {
            type: "tool_use",
            id: "tu_1",
            name: "Bash",
            input: { command: "echo hi", run_in_background: false },
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "should not be reached" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({ provider, signal: controller.signal });
    const resultPromise = runAgentLoop(params);
    // Mirrors production: TaskRegistry.stop()/AgentRuntime.stopRoot() call this from outside
    // while a turn is already underway (this test's synchronous timing lands it between the
    // tool call resolving and the next turn's between-turn check, exactly like the
    // "SendMessage injection" test above lands its injection between turns).
    controller.abort();
    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.turns).toBe(1);
    // The partial text from the turn that DID complete before the stop is preserved, not
    // discarded — same convention as every other failure path in this file.
    expect(result.finalOutput).toBe("partial thought");
    expect(provider.calls).toHaveLength(1);
    expect(
      logLines.some((l) => l.type === "failed" && l.reason === STOPPED_BETWEEN_TURNS_REASON),
    ).toBe(true);
  });

  test("aborting while the provider call is in flight is reported as stopped-during-provider-call, interrupting it rather than waiting for a response", async () => {
    const controller = new AbortController();
    let rejectedWithAbort = false;
    const provider: ModelProvider = {
      complete(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            rejectedWithAbort = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      },
    };
    const { params, logLines } = baseParams({ provider, signal: controller.signal });
    const resultPromise = runAgentLoop(params);
    controller.abort();
    const result = await resultPromise;
    expect(rejectedWithAbort).toBe(true);
    expect(result.success).toBe(false);
    expect(result.turns).toBe(1);
    expect(
      logLines.some((l) => l.type === "failed" && l.reason === STOPPED_DURING_PROVIDER_CALL_REASON),
    ).toBe(true);
  });

  test("a genuine provider error unrelated to the signal still propagates — not silently treated as a stop", async () => {
    const provider: ModelProvider = {
      async complete() {
        throw new Error("network exploded");
      },
    };
    const { params } = baseParams({ provider });
    await expect(runAgentLoop(params)).rejects.toThrow("network exploded");
  });

  test("a provider error while a signal exists but was never aborted still propagates", async () => {
    const controller = new AbortController();
    const provider: ModelProvider = {
      async complete() {
        throw new Error("network exploded");
      },
    };
    const { params } = baseParams({ provider, signal: controller.signal });
    await expect(runAgentLoop(params)).rejects.toThrow("network exploded");
  });

  test("without a signal at all, the loop behaves exactly as before (no crash, no change in outcome)", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "all good" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("all good");
  });
});
