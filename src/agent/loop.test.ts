import { describe, expect, test } from "bun:test";
import type { LogLine, ServerSentEvent } from "../contracts/index.ts";
import {
  computeCostUsd,
  type ModelBinding,
  REPORT_OUTCOME_NUDGE_MESSAGE,
  runAgentLoop,
  STOPPED_BETWEEN_TURNS_REASON,
  STOPPED_DURING_PROVIDER_CALL_REASON,
  TASK_FAILED_MARKER,
} from "./loop.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from "./providers/types.ts";
import { ProviderError } from "./providers/types.ts";
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
      providerModel: "sonnet-real-id",
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
      // DH-0050: this test predates the missed-call nudge — the first clean end_turn above
      // now triggers exactly one nudge turn before the loop's legacy fallback can terminate
      // it; this repeats the same text so finalOutput/success are unaffected, just one turn
      // later (see the dedicated DH-0050 describe block below for nudge-specific assertions).
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
    expect(result.turns).toBe(3);

    // Events shaped per src/contracts/events.type.ts
    expect(events.some((e) => e.type === "agent_spawned")).toBe(true);
    expect(events.some((e) => e.type === "agent_output" && e.chunk.includes("All done"))).toBe(
      true,
    );
    expect(events.some((e) => e.type === "token_usage")).toBe(true);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe("done");

    // Log lines shaped per src/contracts/log.type.ts
    expect(logLines[0]?.type).toBe("header");
    expect(logLines.some((l) => l.type === "tool_call" && l.toolName === "Bash")).toBe(true);
    expect(logLines.some((l) => l.type === "tool_result")).toBe(true);
    expect(logLines.some((l) => l.type === "completed")).toBe(true);

    // The tool_result was fed back to the provider on the second call.
    expect(provider.calls[1]?.messages.at(-1)?.content[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_1",
    });

    // DH-0089: tool_call/tool_result SSE events are emitted, shaped per
    // src/contracts/events.type.ts, and appear immediately before their JSONL counterparts.
    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent).toMatchObject({
      type: "tool_call",
      agentId: "agent-root",
      toolUseId: "tu_1",
      toolName: "Bash",
      inputSummary: "echo hi",
    });
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      type: "tool_result",
      agentId: "agent-root",
      toolUseId: "tu_1",
      toolName: "Bash",
      isError: false,
    });
    expect(
      toolResultEvent && toolResultEvent.type === "tool_result" && toolResultEvent.durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  // DH-0089 D2: verifies the exact emission ordering the design calls for — the SSE event
  // fires immediately before its JSONL log-line counterpart, for both the call and the
  // result — by recording both sinks into one combined, interleaved sequence.
  test("tool_call/tool_result SSE events are each emitted immediately before their JSONL counterpart", async () => {
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
      // DH-0050: see the identical comment in the previous test — one extra nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "All done, task succeeded." }],
        usage: { inputTokens: 12, outputTokens: 6 },
      },
    ]);
    const sequence: string[] = [];
    const { params } = baseParams({
      provider,
      onEvent: (e: ServerSentEvent) => sequence.push(`event:${e.type}`),
      onLogLine: (l: LogLine) => sequence.push(`log:${l.type}`),
    });
    await runAgentLoop(params);

    const callEventIdx = sequence.indexOf("event:tool_call");
    const callLogIdx = sequence.indexOf("log:tool_call");
    const resultEventIdx = sequence.indexOf("event:tool_result");
    const resultLogIdx = sequence.indexOf("log:tool_result");

    expect(callEventIdx).toBeGreaterThanOrEqual(0);
    expect(callLogIdx).toBe(callEventIdx + 1);
    expect(resultEventIdx).toBeGreaterThan(callLogIdx);
    expect(resultLogIdx).toBe(resultEventIdx + 1);
  });

  // Round 11 regression (docs/handoffs/core.md status log): the provider must receive
  // `providerModel` (the config's real provider-side model id), never `model` (the friendly
  // config alias used only for display in events/log headers). Deliberately uses a config
  // where the two differ — this exact bug was invisible in any test/config where they
  // happened to match, which is presumably why it shipped unnoticed.
  test("provider.complete() receives providerModel, not the friendly display model alias", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn — this test only inspects provider.calls[0].
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events, logLines } = baseParams({
      provider,
      model: "bedrock-sonnet",
      providerModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    });
    await runAgentLoop(params);

    // The wire truth: the provider call itself uses the real provider-side id.
    expect(provider.calls[0]?.model).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
    expect(provider.calls[0]?.model).not.toBe("bedrock-sonnet");

    // Display surfaces (SSE agent_spawned event, JSONL log header) still show the friendly
    // config alias, unaffected by the fix.
    const spawnedEvent = events.find((e) => e.type === "agent_spawned");
    expect(spawnedEvent && spawnedEvent.type === "agent_spawned" && spawnedEvent.model).toBe(
      "bedrock-sonnet",
    );
    const header = logLines.find((l) => l.type === "header");
    expect(header && header.type === "header" && header.model).toBe("bedrock-sonnet");
  });

  test("TASK_FAILED marker in the final text reports self-reported failure", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: `I could not finish. ${TASK_FAILED_MARKER}` }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn — the model repeats the same marker after being nudged.
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
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    const toolResultLog = logLines.find((l) => l.type === "tool_result");
    expect(toolResultLog && toolResultLog.type === "tool_result" && toolResultLog.isError).toBe(
      true,
    );

    // DH-0089: the unknown-tool-name branch still emits both SSE events, with the tool_call
    // event's inputSummary falling back to compact JSON (empty input object) and the
    // tool_result event correctly marked as an error.
    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent).toMatchObject({
      type: "tool_call",
      toolName: "NotARealTool",
      inputSummary: "{}",
    });
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      type: "tool_result",
      toolName: "NotARealTool",
      isError: true,
    });
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

  // Round 6b (docs/handoffs/core.md): costUsd was fully wired end-to-end (contracts + Web
  // display) but nothing ever computed a real value. Proves the loop computes it when
  // `pricing` is configured, and leaves it undefined (no regression) when it isn't.
  test("token_usage events get a computed costUsd when pricing is configured", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      },
    ]);
    const { params, events } = baseParams({
      provider,
      pricing: { inputPricePerMToken: 3, outputPricePerMToken: 15 },
    });
    await runAgentLoop(params);
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent?.type).toBe("token_usage");
    // 1M input tokens @ $3/M + 0.5M output tokens @ $15/M = $3 + $7.5 = $10.5
    expect(usageEvent && "costUsd" in usageEvent ? usageEvent.costUsd : undefined).toBe(10.5);
  });

  test("token_usage events leave costUsd undefined when pricing isn't configured (no regression)", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const { params, events } = baseParams({ provider });
    await runAgentLoop(params);
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent?.type).toBe("token_usage");
    expect(usageEvent && "costUsd" in usageEvent ? usageEvent.costUsd : undefined).toBeUndefined();
  });

  // Round 10 (docs/handoffs/core.md): Round 6b's costUsd only ever reached the ephemeral SSE
  // `token_usage` event, never the durable JSONL `token_usage` log line (the type didn't even
  // have the field) — meaning cost was unrecoverable after the fact, defeating the whole
  // point of after-the-fact dark-factory cost diagnostics. Proves the JSONL log line itself
  // (not just the SSE event) carries costUsd when pricing is configured, and stays undefined
  // (no regression) when it isn't.
  test("token_usage LOG LINES get a computed costUsd when pricing is configured", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      },
    ]);
    const { params, logLines } = baseParams({
      provider,
      pricing: { inputPricePerMToken: 3, outputPricePerMToken: 15 },
    });
    await runAgentLoop(params);
    const usageLine = logLines.find((l) => l.type === "token_usage");
    expect(usageLine?.type).toBe("token_usage");
    // 1M input tokens @ $3/M + 0.5M output tokens @ $15/M = $3 + $7.5 = $10.5
    expect(usageLine && "costUsd" in usageLine ? usageLine.costUsd : undefined).toBe(10.5);
  });

  test("token_usage LOG LINES leave costUsd undefined when pricing isn't configured (no regression)", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const { params, logLines } = baseParams({ provider });
    await runAgentLoop(params);
    const usageLine = logLines.find((l) => l.type === "token_usage");
    expect(usageLine?.type).toBe("token_usage");
    expect(usageLine && "costUsd" in usageLine ? usageLine.costUsd : undefined).toBeUndefined();
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
      // DH-0050: one nudge-ack turn.
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

// DH-0093: model-switch mechanism — a pushed ModelBinding takes effect on the very next turn
// (not mid-flight), the loop is never restarted, and both the emitted SSE event/log line and
// cost accounting follow the new binding.
describe("runAgentLoop — DH-0093: mid-session model switch via registerModelSwitch", () => {
  test("a pushed model switch takes effect starting the next provider.complete() call, not the in-flight one, and the messages history survives intact", async () => {
    const providerA: ModelProvider & { calls: ProviderCompletionRequest[] } = scriptedProvider([
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
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const providerB: ModelProvider & { calls: ProviderCompletionRequest[] } = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "answered by provider B" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "answered by provider B" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    let switchFn: ((binding: ModelBinding) => void) | undefined;
    const { params, events, logLines } = baseParams({
      provider: providerA,
      registerModelSwitch: (fn) => {
        switchFn = fn;
      },
    });

    const resultPromise = runAgentLoop(params);
    // Push the switch while providerA's first (and only scripted) turn is already in flight —
    // proves it does NOT affect that in-flight call, only the next one.
    switchFn?.({ model: "other-model", providerModel: "other-provider-id", provider: providerB });
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("answered by provider B");
    // The in-flight (first) call still went to providerA with the original providerModel.
    expect(providerA.calls).toHaveLength(1);
    expect(providerA.calls[0]?.model).toBe("sonnet-real-id");
    // The next turn's call went to providerB with the new providerModel — the switch took
    // effect starting the next turn, not mid-flight. (DH-0050: a second providerB call
    // follows, the missed-call nudge-ack — irrelevant to this test's own assertions.)
    expect(providerB.calls.length).toBeGreaterThanOrEqual(1);
    expect(providerB.calls[0]?.model).toBe("other-provider-id");
    // Messages history is the same array threaded across both calls (the loop was never
    // restarted) — the second call's history includes the first call's tool_use/tool_result.
    expect(
      providerB.calls[0]?.messages.some((m) =>
        m.content.some((c) => c.type === "tool_result" && c.toolUseId === "tu_1"),
      ),
    ).toBe(true);

    const switchedEvent = events.find((e) => e.type === "model_switched");
    expect(switchedEvent).toMatchObject({
      type: "model_switched",
      agentId: "agent-root",
      from: "sonnet",
      to: "other-model",
    });
    const switchedLog = logLines.find((l) => l.type === "model_switched");
    expect(switchedLog).toMatchObject({
      type: "model_switched",
      from: "sonnet",
      to: "other-model",
    });
  });

  test("cost accounting follows the new binding's pricing after a switch", async () => {
    const providerA = scriptedProvider([
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
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      },
    ]);
    const providerB = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      },
    ]);

    let switchFn: ((binding: ModelBinding) => void) | undefined;
    const { params, events } = baseParams({
      provider: providerA,
      pricing: { inputPricePerMToken: 3 },
      registerModelSwitch: (fn) => {
        switchFn = fn;
      },
    });

    const resultPromise = runAgentLoop(params);
    // Wait for the first turn's own token_usage (and its costUsd, computed against the
    // ORIGINAL pricing) to be fully emitted before pushing the switch — pushing it any
    // earlier would race the first turn's own post-completion cost computation (an artifact
    // of this synchronous scripted-provider test setup, not a real race in production, where
    // switch_model always arrives via a separate async HTTP request).
    while (!events.some((e) => e.type === "token_usage")) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    switchFn?.({
      model: "other-model",
      providerModel: "other-provider-id",
      provider: providerB,
      pricing: { inputPricePerMToken: 10 },
    });
    await resultPromise;

    const usageEvents = events.filter((e) => e.type === "token_usage");
    // First (in-flight) turn's usage still costed against the ORIGINAL pricing ($3/M).
    expect(usageEvents[0] && "costUsd" in usageEvents[0] ? usageEvents[0].costUsd : undefined).toBe(
      3,
    );
    // Second turn's usage costed against the NEW binding's pricing ($10/M).
    expect(usageEvents[1] && "costUsd" in usageEvents[1] ? usageEvents[1].costUsd : undefined).toBe(
      10,
    );
  });

  test("without registerModelSwitch, behavior is exactly unchanged (no regression)", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "no switch involved" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "no switch involved" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("no switch involved");
  });
});

describe("runAgentLoop — DH-0045: extended thinking threading + emission", () => {
  test("threads params.thinking into every provider.complete() request", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider, thinking: { type: "adaptive" } });
    await runAgentLoop(params);
    expect(provider.calls[0]?.thinking).toEqual({ type: "adaptive" });
    expect(provider.calls[1]?.thinking).toEqual({ type: "adaptive" });
  });

  test("no thinking param is sent when params.thinking is absent (no regression)", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    await runAgentLoop(params);
    expect(provider.calls[0]?.thinking).toBeUndefined();
  });

  test("a non-empty thinking block emits SSE agent_thinking and JSONL thinking, before the text output", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "reasoning through it", signature: "sig-1" },
          { type: "text", text: "done, task succeeded." },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events, logLines } = baseParams({ provider, thinking: { type: "adaptive" } });
    await runAgentLoop(params);

    const thinkingEvent = events.find((e) => e.type === "agent_thinking");
    expect(thinkingEvent).toMatchObject({
      type: "agent_thinking",
      agentId: "agent-root",
      chunk: "reasoning through it",
    });
    expect(
      thinkingEvent && "redacted" in thinkingEvent ? thinkingEvent.redacted : undefined,
    ).toBeUndefined();

    const thinkingLine = logLines.find((l) => l.type === "thinking");
    expect(thinkingLine).toEqual({
      version: 1,
      timestamp: expect.any(String),
      type: "thinking",
      content: "reasoning through it",
      redacted: false,
    });

    // Ordering: the thinking event/line precede the output event/line for the same turn.
    const thinkingEventIdx = events.findIndex((e) => e.type === "agent_thinking");
    const outputEventIdx = events.findIndex(
      (e) => e.type === "agent_output" && e.chunk.includes("done, task succeeded"),
    );
    expect(thinkingEventIdx).toBeLessThan(outputEventIdx);
  });

  test("a redacted_thinking block emits agent_thinking/thinking with redacted:true and empty content — ciphertext never reaches SSE or JSONL", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "redacted_thinking", data: "supersecretciphertext==" },
          { type: "text", text: "done, task succeeded." },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events, logLines } = baseParams({ provider, thinking: { type: "adaptive" } });
    await runAgentLoop(params);

    const thinkingEvent = events.find((e) => e.type === "agent_thinking");
    expect(thinkingEvent).toMatchObject({ type: "agent_thinking", chunk: "", redacted: true });

    const thinkingLine = logLines.find((l) => l.type === "thinking");
    expect(thinkingLine).toEqual({
      version: 1,
      timestamp: expect.any(String),
      type: "thinking",
      content: "",
      redacted: true,
    });

    // No event/log line anywhere carries the ciphertext.
    expect(JSON.stringify(events)).not.toContain("supersecretciphertext");
    expect(JSON.stringify(logLines)).not.toContain("supersecretciphertext");
  });

  test("an empty-text thinking block (display: omitted) emits nothing", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "", signature: "sig-empty" },
          { type: "text", text: "done, task succeeded." },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events, logLines } = baseParams({
      provider,
      thinking: { type: "adaptive", display: "omitted" },
    });
    await runAgentLoop(params);

    expect(events.some((e) => e.type === "agent_thinking")).toBe(false);
    expect(logLines.some((l) => l.type === "thinking")).toBe(false);
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
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe(
      "stopped",
    );
    expect(
      logLines.some(
        (l) =>
          l.type === "status_change" &&
          l.status === "stopped" &&
          l.reason === STOPPED_BETWEEN_TURNS_REASON,
      ),
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
      logLines.some(
        (l) =>
          l.type === "status_change" &&
          l.status === "stopped" &&
          l.reason === STOPPED_BETWEEN_TURNS_REASON,
      ),
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
      logLines.some(
        (l) =>
          l.type === "status_change" &&
          l.status === "stopped" &&
          l.reason === STOPPED_DURING_PROVIDER_CALL_REASON,
      ),
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
      // DH-0050: one nudge-ack turn.
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

describe("runAgentLoop — Round 5: interactive mode pauses instead of ending on a non-tool-use turn", () => {
  test("without interactive: true, behavior is exactly unchanged — a non-tool-use turn still ends the loop", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, as before" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, as before" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe("done");
  });

  test("interactive: true pauses 'waiting' on a non-tool-use turn instead of returning, then resumes on the next message with history intact", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "here's my answer" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "here's my second answer" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    let sendFn: ((message: string) => void) | undefined;
    const controller = new AbortController();
    const { params, events } = baseParams({
      provider,
      interactive: true,
      signal: controller.signal,
      registerSendMessage: (fn) => {
        sendFn = fn;
      },
    });
    const resultPromise = runAgentLoop(params);

    // The loop must pause "waiting", not return — the promise stays pending.
    while (!events.some((e) => e.type === "agent_status" && e.status === "waiting")) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    let settled = false;
    resultPromise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    sendFn?.("a follow-up question");
    // The pause resolves once the second message is delivered; the loop resumes and the
    // provider's second scripted response is what the loop is waiting on next.
    while (
      !events.some((e) => e.type === "agent_output" && e.chunk.includes("here's my second answer"))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // The second provider call's own message history includes the injected follow-up.
    expect(provider.calls).toHaveLength(2);
    const secondCallHasFollowUp = provider.calls[1]?.messages.some((m) =>
      m.content.some((c) => c.type === "text" && c.text.includes("a follow-up question")),
    );
    expect(secondCallHasFollowUp).toBe(true);

    // Only a genuine stop ends the interactive loop — abort it to let the test finish
    // cleanly rather than leaving the pending promise dangling past the test's own scope.
    controller.abort();
    await resultPromise;
  });

  test("aborting while paused 'waiting' for the next message reports stopped, not a crash or a hang", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "waiting for you" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const controller = new AbortController();
    const { params, events, logLines } = baseParams({
      provider,
      interactive: true,
      signal: controller.signal,
    });
    const resultPromise = runAgentLoop(params);
    while (!events.some((e) => e.type === "agent_status" && e.status === "waiting")) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    controller.abort();
    const result = await resultPromise;
    // DH-0059: stopping an agent paused in "waiting" is a graceful end of the conversation,
    // not an interrupted task — unlike the between-turns/mid-provider-call stop points,
    // this one reports success so `session_ended` carries exitCode 0.
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe("waiting for you");
    expect(
      logLines.some(
        (l) =>
          l.type === "status_change" &&
          l.status === "stopped" &&
          l.reason?.includes("waiting for the next message"),
      ),
    ).toBe(true);
  });
});

describe("runAgentLoop — DH-0002: per-turn toolDefs, no-mcpServers behavioral identity", () => {
  test(
    "with only non-deferred (built-in-shaped) tools, the tools array sent to the " +
      "provider is identical across every turn and matches what the pre-DH-0002 " +
      "compute-toolDefs-once code would have produced",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "Bash",
              input: { command: "echo hi", run_in_background: false },
            },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call-2",
              name: "Bash",
              input: { command: "echo hi again", run_in_background: false },
            },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "done" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        // DH-0050: one nudge-ack turn.
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "done" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      // Every tool in this Map is built-in-shaped: `deferred` is never set (mirrors ALL_TOOLS —
      // no MCP tool ever gets merged in when no mcpServers are configured, per runtime.ts).
      const tools = buildToolMap();
      const { params } = baseParams({ provider, tools });

      const result = await runAgentLoop(params);
      expect(result.success).toBe(true);
      expect(provider.calls).toHaveLength(4);

      // This is exactly what the OLD (pre-DH-0002) code computed once, before the turn loop:
      // `[...params.tools.values()].map((t) => ({ name, description, inputSchema }))` — with
      // no `deferred` tools present, the new per-turn filter is a no-op, so every turn's
      // `tools` array must be reference-shape-identical to this and to each other.
      const expectedToolDefs = [...tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      for (const call of provider.calls) {
        expect(call.tools).toEqual(expectedToolDefs);
      }
      // Bit-for-bit identical across turns, not just each individually equal to expected.
      expect(provider.calls[0]?.tools).toEqual(provider.calls[1]?.tools);
      expect(provider.calls[1]?.tools).toEqual(provider.calls[2]?.tools);
    },
  );

  test("a deferred tool not yet activated is filtered out of every turn's tools array", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // DH-0050: one nudge-ack turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const tools = buildToolMap();
    tools.set("mcp__github__create_issue", {
      name: "mcp__github__create_issue",
      description: "Create a GitHub issue.",
      inputSchema: { type: "object", properties: {} },
      deferred: true,
      async execute() {
        return { output: "unused", isError: false };
      },
    });
    const { params } = baseParams({ provider, tools });

    await runAgentLoop(params);
    const sentNames = provider.calls[0]?.tools.map((t) => t.name) ?? [];
    expect(sentNames).not.toContain("mcp__github__create_issue");
  });

  test(
    "a deferred tool activated mid-loop (by a ToolSearch-style call) appears starting " +
      "the very next turn, not the one where it was activated",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "tool_use",
          content: [{ type: "tool_use", id: "call-1", name: "ActivatingSearch", input: {} }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "turn 2: done" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        // DH-0050: one nudge-ack turn.
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "turn 2: done" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const tools = buildToolMap();
      tools.set("mcp__github__create_issue", {
        name: "mcp__github__create_issue",
        description: "Create a GitHub issue.",
        inputSchema: { type: "object", properties: {} },
        deferred: true,
        async execute() {
          return { output: "unused", isError: false };
        },
      });
      // Stands in for ToolSearch's real activation side effect (runtime.ts's
      // searchDeferredTools closure adds to ctx.activatedTools when a result is selected) —
      // this tool mutates the SAME ToolContext the loop passes to every tool call.
      const toolContext = makeToolContext();
      tools.set("ActivatingSearch", {
        name: "ActivatingSearch",
        description: "test-only stand-in for ToolSearch's activation side effect",
        inputSchema: { type: "object", properties: {} },
        async execute(_input, ctx) {
          ctx.activatedTools.add("mcp__github__create_issue");
          return { output: "activated", isError: false };
        },
      });
      const { params } = baseParams({ provider, tools, toolContext });

      await runAgentLoop(params);

      // Turn 1's request was built BEFORE ActivatingSearch ran, so the deferred tool is still
      // hidden; only turn 2 (built fresh, after activation) includes it. Proves the per-turn
      // recompute — not a one-time-before-the-loop computation — is what makes this possible.
      expect(provider.calls[0]?.tools.map((t) => t.name)).not.toContain(
        "mcp__github__create_issue",
      );
      expect(provider.calls[1]?.tools.map((t) => t.name)).toContain("mcp__github__create_issue");
    },
  );
});

describe("runAgentLoop — DH-0044: streaming coalescing, fallback, and mid-turn partial output", () => {
  /** A fake provider that invokes `callbacks.onTextDelta` for each entry in `deltas`
   * (synchronously, in order) before resolving with `result` — simulates a real streaming
   * adapter's side-channel without any real SDK involved. */
  function streamingProvider(
    deltas: string[],
    result: ProviderCompletionResult,
  ): ModelProvider & { calls: number } {
    let calls = 0;
    return {
      async complete(_request, _signal, callbacks) {
        calls += 1;
        for (const delta of deltas) {
          callbacks?.onTextDelta?.(delta);
        }
        return result;
      },
      get calls() {
        return calls;
      },
    };
  }

  test("small deltas well under the byte threshold coalesce into one agent_output event, flushed at turn completion", async () => {
    // stopReason: "tool_use" + maxTurns: 1 keeps this a single-provider-call test regardless
    // of DH-0050's non-tool-use nudge/self-report precedence (orthogonal to streaming, and
    // not this ticket's concern) — the turn ends after exactly one provider.complete() call
    // either way, so the streaming/coalescing behavior under test is unaffected.
    const provider = streamingProvider(["Hel", "lo, ", "world!"], {
      stopReason: "tool_use",
      content: [{ type: "text", text: "Hello, world!" }],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { params, events, logLines } = baseParams({ provider, maxTurns: 1 });
    const result = await runAgentLoop(params);

    const outputEvents = events.filter((e) => e.type === "agent_output");
    // All three deltas are well under STREAM_FLUSH_BYTES and arrive faster than
    // STREAM_FLUSH_INTERVAL_MS (synchronously, in this test) — coalesced into exactly one
    // flush, which happens at turn completion (not the removed whole-turn fallback path,
    // since deltaCount > 0 here).
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ chunk: "Hello, world!" });
    // The JSONL log stays turn-granular regardless: exactly one non-partial `message` line
    // with the full text, sourced from completion.content — not the chunk stream.
    const messageLines = logLines.filter((l) => l.type === "message" && l.role === "assistant");
    expect(messageLines).toEqual([
      {
        version: 1,
        timestamp: expect.any(String),
        type: "message",
        role: "assistant",
        content: "Hello, world!",
      },
    ]);
    expect(result.finalOutput).toBe("Hello, world!");
  });

  test("a delta that pushes the buffer at/over STREAM_FLUSH_BYTES flushes immediately, before the turn completes", async () => {
    const big = "x".repeat(1024);
    const provider = streamingProvider(["small ", big, " tail"], {
      stopReason: "tool_use",
      content: [{ type: "text", text: `small ${big} tail` }],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { params, events } = baseParams({ provider, maxTurns: 1 });
    await runAgentLoop(params);

    const outputEvents = events.filter((e) => e.type === "agent_output");
    // First flush fires as soon as the buffer ("small " + big) crosses 1024 bytes — before
    // the turn resolves; the remaining " tail" flushes at turn completion as a second event.
    expect(outputEvents).toHaveLength(2);
    expect(outputEvents[0]).toMatchObject({ chunk: `small ${big}` });
    expect(outputEvents[1]).toMatchObject({ chunk: " tail" });
  });

  test("a provider that streams no deltas at all falls back to one whole-turn agent_output event, exactly as before streaming existed", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "text", text: "whole turn at once" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, events } = baseParams({ provider, maxTurns: 1 });
    await runAgentLoop(params);

    const outputEvents = events.filter((e) => e.type === "agent_output");
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ chunk: "whole turn at once" });
  });

  test("ordering: the flushed agent_output event precedes the same turn's token_usage event", async () => {
    const provider = streamingProvider(["streamed text"], {
      stopReason: "tool_use",
      content: [{ type: "text", text: "streamed text" }],
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    const { params, events } = baseParams({ provider, maxTurns: 1 });
    await runAgentLoop(params);

    const relevantTypes = events
      .filter((e) => e.type === "agent_output" || e.type === "token_usage")
      .map((e) => e.type);
    expect(relevantTypes).toEqual(["agent_output", "token_usage"]);
  });

  test("a delta under threshold flushes on its own via the 50ms timer when the turn takes longer than that to complete", async () => {
    const provider: ModelProvider = {
      async complete(_request, _signal, callbacks) {
        callbacks?.onTextDelta?.("slow trickle");
        // Long enough that STREAM_FLUSH_INTERVAL_MS (50ms) fires the pending flush timer
        // before this turn ever resolves — proves the timer path actually flushes on its
        // own, not just the turn-completion flush every other test in this file exercises.
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          stopReason: "tool_use",
          content: [{ type: "text", text: "slow trickle" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const { params, events } = baseParams({ provider, maxTurns: 1 });
    await runAgentLoop(params);

    const outputEvents = events.filter((e) => e.type === "agent_output");
    // The timer fired mid-turn and flushed the only delta; the turn-completion flush that
    // follows finds an empty buffer and is a no-op — exactly one event either way.
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ chunk: "slow trickle" });
  });

  test("mid-turn provider failure after >=1 delta streamed logs the accumulated partial text with partial: true, then rethrows (non-abort path unchanged)", async () => {
    const provider: ModelProvider = {
      async complete(_request, _signal, callbacks) {
        callbacks?.onTextDelta?.("partial output ");
        callbacks?.onTextDelta?.("before the crash");
        throw new Error("provider exploded mid-stream");
      },
    };
    const { params, events, logLines } = baseParams({ provider });

    await expect(runAgentLoop(params)).rejects.toThrow("provider exploded mid-stream");

    // The buffered partial text was flushed live as agent_output before the throw...
    const outputEvents = events.filter((e) => e.type === "agent_output");
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ chunk: "partial output before the crash" });

    // ...and also durably recorded as a `partial: true` message log line, so it's not lost
    // from the JSONL log just because the turn never completed normally.
    const partialLines = logLines.filter(
      (l) => l.type === "message" && "partial" in l && l.partial === true,
    );
    expect(partialLines).toEqual([
      {
        version: 1,
        timestamp: expect.any(String),
        type: "message",
        role: "assistant",
        content: "partial output before the crash",
        partial: true,
      },
    ]);
  });

  test("mid-turn provider failure with zero deltas streamed logs no partial line (nothing to record)", async () => {
    const provider: ModelProvider = {
      async complete() {
        throw new Error("failed before streaming anything");
      },
    };
    const { params, logLines } = baseParams({ provider });

    await expect(runAgentLoop(params)).rejects.toThrow("failed before streaming anything");

    const partialLines = logLines.filter((l) => l.type === "message" && "partial" in l);
    expect(partialLines).toEqual([]);
  });

  test("a genuine stop (AbortSignal) mid-provider-call after streaming still flushes and logs the partial line before reportStopped runs", async () => {
    const controller = new AbortController();
    const provider: ModelProvider = {
      async complete(_request, signal, callbacks) {
        callbacks?.onTextDelta?.("streamed before stop");
        controller.abort();
        // Simulate the provider observing the abort and rejecting, same as a real SDK call
        // whose signal fires mid-request.
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        throw new Error("unreachable");
      },
    };
    const { params, events, logLines } = baseParams({ provider, signal: controller.signal });

    const result = await runAgentLoop(params);

    expect(result.success).toBe(false);
    const statusEvents = events.filter((e) => e.type === "agent_status");
    expect(statusEvents[statusEvents.length - 1]).toMatchObject({ status: "stopped" });

    const partialLines = logLines.filter(
      (l) => l.type === "message" && "partial" in l && l.partial === true,
    );
    expect(partialLines).toHaveLength(1);
    expect(partialLines[0]).toMatchObject({ content: "streamed before stop" });
  });
});

// DH-0050: the ReportOutcome self-report mechanism's detection precedence, exercised
// entirely at the loop level via scriptedProvider — none of these need the tool actually
// registered in `params.tools` (loop.ts only inspects the completion's tool_use blocks by
// name), matching how the real runtime only ever registers it for non-interactive runs.
describe("runAgentLoop — DH-0050 ReportOutcome self-report", () => {
  test("a valid ReportOutcome(success) call is terminal and authoritative", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "ReportOutcome",
            input: { status: "success", summary: "did the thing", filesChanged: ["a.ts"] },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const { params, events, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(result.success).toBe(true);
    expect(result.reportedBy).toBe("tool");
    expect(result.outcome).toEqual({
      status: "success",
      summary: "did the thing",
      filesChanged: ["a.ts"],
    });
    // Only one provider call — the loop never asks for a second turn once a valid call lands.
    expect(provider.calls).toHaveLength(1);

    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent && statusEvent.type === "agent_status" && statusEvent.status).toBe("done");
    const completedLine = logLines.find((l) => l.type === "completed");
    expect(completedLine).toMatchObject({
      type: "completed",
      success: true,
      outcome: result.outcome,
    });
  });

  test("a valid ReportOutcome(failure) call reports failure, not success", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "failure" } },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(result.success).toBe(false);
    expect(result.reportedBy).toBe("tool");
    expect(result.outcome).toEqual({ status: "failure" });
    const failedLine = logLines.find((l) => l.type === "failed");
    expect(failedLine).toMatchObject({
      type: "failed",
      reason: "model reported failure via ReportOutcome",
      outcome: { status: "failure" },
    });
  });

  test("the last valid ReportOutcome call in a turn wins when the model calls it twice", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "failure" } },
          { type: "tool_use", id: "tu_2", name: "ReportOutcome", input: { status: "success" } },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(result.success).toBe(true);
    expect(result.outcome).toEqual({ status: "success" });
  });

  test("an invalid status doesn't terminate the run — the model gets another turn", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [
          // Garbled: "status" isn't a recognized value — degrades gracefully, no crash.
          { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "maybe" } },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_2", name: "ReportOutcome", input: { status: "success" } },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);
    expect(provider.calls).toHaveLength(2);
    expect(result.success).toBe(true);
    expect(result.reportedBy).toBe("tool");
  });

  test(
    "a non-tool-use turn with no ReportOutcome call gets exactly one nudge, then the model " +
      "complies and the loop ends via the tool",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "I think I'm done." }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "tool_use",
          content: [
            { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "success" } },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const { params, logLines } = baseParams({ provider });
      const result = await runAgentLoop(params);

      expect(provider.calls).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.reportedBy).toBe("tool");
      // The nudge text reached the model as a user message on the second call.
      const secondCallMessages = provider.calls[1]?.messages ?? [];
      const lastMessage = secondCallMessages[secondCallMessages.length - 1];
      expect(lastMessage?.role).toBe("user");
      expect(lastMessage?.content).toEqual([{ type: "text", text: REPORT_OUTCOME_NUDGE_MESSAGE }]);
      expect(
        logLines.some(
          (l) =>
            l.type === "message" && l.role === "user" && l.content === REPORT_OUTCOME_NUDGE_MESSAGE,
        ),
      ).toBe(true);
    },
  );

  test(
    "a nudge is sent only once — a second consecutive non-tool-use turn falls back to the " +
      "legacy marker scan instead of nudging again",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "still thinking" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "All done, no marker here." }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const { params } = baseParams({ provider });
      const result = await runAgentLoop(params);

      expect(provider.calls).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.reportedBy).toBe("clean-end");
      expect(result.finalOutput).toBe("All done, no marker here.");
    },
  );

  // DH-0140 User Story: an agent waiting on its own spawned children (sub-agents or
  // background Bash calls still `running`/`waiting`) shouldn't get end-out-from-under-it by
  // the missed-call nudge — it's deliberately polling, not forgetting to self-report.
  test(
    "DH-0140: the nudge is skipped (not just deferred) while hasPendingChildren() reports " +
      "outstanding children — the loop just starts another turn",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "still waiting on my children" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "tool_use",
          content: [
            { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "success" } },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const { params, logLines } = baseParams({
        provider,
        hasPendingChildren: () => true,
      });
      const result = await runAgentLoop(params);

      expect(provider.calls).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.reportedBy).toBe("tool");
      // No nudge text was ever injected — the second call's last message is NOT the nudge.
      const secondCallMessages = provider.calls[1]?.messages ?? [];
      const lastMessage = secondCallMessages[secondCallMessages.length - 1];
      expect(lastMessage?.content).not.toEqual([
        { type: "text", text: REPORT_OUTCOME_NUDGE_MESSAGE },
      ]);
      expect(
        logLines.some(
          (l) =>
            l.type === "message" && l.role === "user" && l.content === REPORT_OUTCOME_NUDGE_MESSAGE,
        ),
      ).toBe(false);
    },
  );

  test(
    "DH-0140: once hasPendingChildren() reports no more outstanding children, the nudge " +
      "fires normally on the next non-tool-use turn",
    async () => {
      let childrenPending = true;
      const provider = scriptedProvider([
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "still waiting on my children" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "children finished, still thinking" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "tool_use",
          content: [
            { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "success" } },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const { params, logLines } = baseParams({
        provider,
        hasPendingChildren: () => {
          const pending = childrenPending;
          childrenPending = false;
          return pending;
        },
      });
      const result = await runAgentLoop(params);

      expect(provider.calls).toHaveLength(3);
      expect(result.success).toBe(true);
      expect(result.reportedBy).toBe("tool");
      // The nudge was injected exactly once, ahead of the third (ReportOutcome) call.
      const thirdCallMessages = provider.calls[2]?.messages ?? [];
      const lastMessage = thirdCallMessages[thirdCallMessages.length - 1];
      expect(lastMessage?.content).toEqual([{ type: "text", text: REPORT_OUTCOME_NUDGE_MESSAGE }]);
      expect(
        logLines.filter(
          (l) =>
            l.type === "message" && l.role === "user" && l.content === REPORT_OUTCOME_NUDGE_MESSAGE,
        ),
      ).toHaveLength(1);
    },
  );

  test("legacy fallback: TASK_FAILED after the nudge is still reported as failure", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "hmm" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: `Couldn't finish. ${TASK_FAILED_MARKER}` }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(result.success).toBe(false);
    expect(result.reportedBy).toBe("text-marker");
  });

  test("max_tokens truncation is an immediate failure — no nudge, no extra turn", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "max_tokens",
        content: [{ type: "text", text: "cut off mid-" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(provider.calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.reportedBy).toBe("max-tokens");
  });

  test("exceeding maxTurns reports reportedBy: max-turns", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "true" } }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "tu_2", name: "Bash", input: { command: "true" } }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider, maxTurns: 2 });
    const result = await runAgentLoop(params);

    expect(result.reportedBy).toBe("max-turns");
    expect(result.success).toBe(false);
  });

  test(
    "interactive mode never checks for ReportOutcome — an unregistered call just reports " +
      "'Unknown tool' and the conversation keeps waiting, it doesn't end the session",
    async () => {
      const provider = scriptedProvider([
        {
          stopReason: "tool_use",
          content: [
            { type: "tool_use", id: "tu_1", name: "ReportOutcome", input: { status: "success" } },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          stopReason: "end_turn",
          content: [{ type: "text", text: "waiting for you" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);
      const controller = new AbortController();
      const { params, logLines } = baseParams({
        provider,
        interactive: true,
        signal: controller.signal,
        registerSendMessage: () => {},
      });
      // Abort right after the loop would otherwise pause in "waiting", so the test doesn't hang.
      const originalOnEvent = params.onEvent;
      params.onEvent = (e) => {
        originalOnEvent?.(e);
        if (e.type === "agent_status" && e.status === "waiting") controller.abort();
      };
      const result = await runAgentLoop(params);

      // Never terminated via the tool — it fell through to the interactive "waiting" pause and
      // was only ended by the test's own abort.
      expect(result.reportedBy).toBeUndefined();
      expect(
        logLines.some(
          (l) => l.type === "tool_result" && l.output === "Unknown tool: ReportOutcome",
        ),
      ).toBe(true);
    },
  );
});

describe("DH-0010 Part A: computeCostUsd cache-token pricing", () => {
  test("given no cache tokens, cost matches pre-DH-0010 input/output-only computation", () => {
    const cost = computeCostUsd(
      { inputPricePerMToken: 3, outputPricePerMToken: 15 },
      1_000_000,
      500_000,
    );
    expect(cost).toBe(10.5);
  });

  test("given explicit cache prices, cache tokens are billed at those rates", () => {
    const cost = computeCostUsd(
      {
        inputPricePerMToken: 3,
        outputPricePerMToken: 15,
        cacheReadPricePerMToken: 0.5,
        cacheWritePricePerMToken: 6,
      },
      0,
      0,
      1_000_000,
      1_000_000,
    );
    expect(cost).toBe(6.5);
  });

  test("given unset cache prices but a configured input price, defaults to 0.1x/1.25x of input", () => {
    const cost = computeCostUsd({ inputPricePerMToken: 10 }, 0, 0, 1_000_000, 1_000_000);
    // cacheRead default 0.1x of $10 = $1/M; cacheWrite default 1.25x of $10 = $12.5/M.
    expect(cost).toBe(1 + 12.5);
  });

  test("given no pricing configured at all, cost stays undefined even with cache tokens present", () => {
    const cost = computeCostUsd(undefined, 100, 50, 10, 10);
    expect(cost).toBeUndefined();
  });
});

describe("DH-0010 Part A: token_usage SSE event mirrors cache tokens", () => {
  test("given the provider reports cache tokens, the SSE token_usage event carries them", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const { params, events } = baseParams({ provider, cache: true });
    await runAgentLoop(params);
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(
      usageEvent && usageEvent.type === "token_usage" ? usageEvent.cacheReadTokens : undefined,
    ).toBe(7);
    expect(
      usageEvent && usageEvent.type === "token_usage" ? usageEvent.cacheWriteTokens : undefined,
    ).toBe(3);
  });

  test("given the provider reports no cache tokens, the SSE event carries no cache fields", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    const { params, events } = baseParams({ provider });
    await runAgentLoop(params);
    const usageEvent = events.find((e) => e.type === "token_usage");
    expect(usageEvent).not.toHaveProperty("cacheReadTokens");
    expect(usageEvent).not.toHaveProperty("cacheWriteTokens");
  });
});

describe("DH-0010 Part A: cache param threaded to provider.complete", () => {
  test("given ModelBinding.cache is true (via params.cache), the request sent to the provider carries cache: true", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider, cache: true });
    await runAgentLoop(params);
    expect(provider.calls[0]?.cache).toBe(true);
  });

  test("given cache is unset, the request sent to the provider carries no cache field", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({ provider });
    await runAgentLoop(params);
    expect(provider.calls[0]).not.toHaveProperty("cache");
  });
});

describe("DH-0010 Part B: context-window compaction", () => {
  test("given contextTokens at/above threshold, the next turn compacts history and emits a compaction log line", async () => {
    const provider = scriptedProvider([
      // Turn 1: usage puts contextTokens (80+15=95) at exactly 95% of a 100-token window.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "turn one done" }],
        usage: { inputTokens: 80, outputTokens: 15 },
      },
      // Nudge-ack (no ReportOutcome, non-interactive) triggers the compaction check before
      // this turn — the summarization call itself (no tools).
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "SUMMARY TEXT" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // Post-compaction turn.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // Final nudge-ack.
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({
      provider,
      contextWindow: 100,
      compaction: { enabled: true, thresholdPercent: 80 },
    });
    await runAgentLoop(params);

    const compactionLine = logLines.find((l) => l.type === "compaction");
    expect(compactionLine).toBeDefined();
    expect(
      compactionLine && compactionLine.type === "compaction" ? compactionLine.preTokens : undefined,
    ).toBe(95);
    expect(
      compactionLine && compactionLine.type === "compaction"
        ? compactionLine.summaryChars
        : undefined,
    ).toBe("SUMMARY TEXT".length);

    // The summarization call itself must have sent no tools.
    const summaryCall = provider.calls.find((c) => c.tools.length === 0);
    expect(summaryCall).toBeDefined();
  });

  test("given contextTokens below threshold, no compaction occurs", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "turn one done" }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({
      provider,
      contextWindow: 1000,
      compaction: { enabled: true, thresholdPercent: 80 },
    });
    await runAgentLoop(params);
    expect(logLines.some((l) => l.type === "compaction")).toBe(false);
  });

  test("given compaction disabled, high contextTokens never triggers compaction", async () => {
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "turn one done" }],
        usage: { inputTokens: 95, outputTokens: 5 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params, logLines } = baseParams({ provider, contextWindow: 100 });
    await runAgentLoop(params);
    expect(logLines.some((l) => l.type === "compaction")).toBe(false);
  });

  test("compacted history's tail starts at an assistant-message boundary", async () => {
    // Build a scripted provider whose first turn (the trigger) is preceded by a seeded
    // resumed history ending mid-tool-exchange, so we can assert the rebuilt tail never
    // starts at a user tool_result message.
    const provider = scriptedProvider([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "trigger turn" }],
        usage: { inputTokens: 90, outputTokens: 5 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "SUMMARY" }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done, task succeeded." }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const { params } = baseParams({
      provider,
      contextWindow: 100,
      compaction: { enabled: true, thresholdPercent: 80 },
      resume: {
        messages: [
          { role: "user", content: [{ type: "text", text: "original instruction" }] },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", toolUseId: "tu_1", content: "ok", isError: false }],
          },
        ],
        fromSessionId: "prior-session",
      },
    });
    await runAgentLoop(params);
    // The post-compaction request (the one after the summarization call) must never start
    // its history with a lone tool_result message (which would orphan the tool_use pairing).
    const postCompactionCall = provider.calls[2];
    expect(postCompactionCall?.messages[0]?.role).toBe("user");
    const firstBlock = postCompactionCall?.messages[0]?.content[0];
    expect(firstBlock?.type).toBe("text");
  });
});

describe("DH-0010 Part B: context_overflow graceful failure", () => {
  test("given the provider throws a context_overflow ProviderError, the agent fails gracefully with an actionable reason", async () => {
    const provider: ModelProvider & { calls: ProviderCompletionRequest[] } = {
      calls: [],
      async complete(request) {
        this.calls.push(request);
        throw new ProviderError("prompt is too long", { kind: "context_overflow" });
      },
    };
    const { params, events, logLines } = baseParams({ provider });
    const result = await runAgentLoop(params);

    expect(result.success).toBe(false);
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(
      statusEvent && statusEvent.type === "agent_status" ? statusEvent.status : undefined,
    ).toBe("failed");
    const failedLine = logLines.find((l) => l.type === "failed");
    expect(failedLine && failedLine.type === "failed" ? failedLine.reason : undefined).toContain(
      "context window exceeded",
    );
    expect(failedLine && failedLine.type === "failed" ? failedLine.reason : undefined).toContain(
      "compaction.enabled",
    );
  });

  test("a non-context_overflow ProviderError still propagates uncaught (no behavior change)", async () => {
    const provider: ModelProvider = {
      async complete() {
        throw new ProviderError("boom", { kind: "other" });
      },
    };
    const { params } = baseParams({ provider });
    await expect(runAgentLoop(params)).rejects.toThrow(ProviderError);
  });
});
