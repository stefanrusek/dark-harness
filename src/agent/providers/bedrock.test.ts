import { describe, expect, test } from "bun:test";
import type { ConverseStreamCommand, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { type BedrockClientLike, BedrockProvider } from "./bedrock.ts";
import type { ProviderStreamCallbacks } from "./types.ts";
import { ProviderError } from "./types.ts";

// DH-0044: both adapters now always request streaming — every fixture here is a fake
// async-iterable `ConverseStreamOutput` sequence rather than a single whole `ConverseCommand`
// response (see bedrock.ts's `BedrockClientLike` doc comment).

async function* streamOf(events: ConverseStreamOutput[]): AsyncGenerator<ConverseStreamOutput> {
  for (const event of events) {
    yield event;
  }
}

function textBlock(index: number, text: string): ConverseStreamOutput[] {
  // Bedrock has no explicit text block-start event — the first delta at an unseen index
  // implicitly opens the accumulator (see bedrock.ts's consumeBedrockStream doc comment).
  return [
    {
      contentBlockDelta: { contentBlockIndex: index, delta: { text } },
    } as unknown as ConverseStreamOutput,
    { contentBlockStop: { contentBlockIndex: index } } as unknown as ConverseStreamOutput,
  ];
}

function toolUseBlock(
  index: number,
  toolUseId: string,
  name: string,
  inputJson: string,
): ConverseStreamOutput[] {
  return [
    {
      contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId, name } } },
    } as unknown as ConverseStreamOutput,
    {
      contentBlockDelta: {
        contentBlockIndex: index,
        delta: { toolUse: { input: inputJson } },
      },
    } as unknown as ConverseStreamOutput,
    { contentBlockStop: { contentBlockIndex: index } } as unknown as ConverseStreamOutput,
  ];
}

function messageStop(stopReason: string): ConverseStreamOutput {
  return { messageStop: { stopReason } } as unknown as ConverseStreamOutput;
}

function metadata(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}): ConverseStreamOutput {
  return { metadata: { usage } } as unknown as ConverseStreamOutput;
}

function fakeClient(events: ConverseStreamOutput[]): BedrockClientLike {
  return { send: async () => ({ stream: streamOf(events) }) };
}

const BASE_REQUEST = {
  model: "gemma4",
  system: "you are a helpful agent",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
  tools: [
    {
      name: "Bash",
      description: "run a command",
      inputSchema: { type: "object" as const, properties: {} },
    },
  ],
};

describe("BedrockProvider", () => {
  test("translates a text response and end_turn stop reason", async () => {
    const client = fakeClient([
      ...textBlock(0, "hello back"),
      messageStop("end_turn"),
      metadata({ inputTokens: 10, outputTokens: 5 }),
    ]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("translates a tool_use response and tool_use stop reason", async () => {
    const client = fakeClient([
      ...toolUseBlock(0, "tu_1", "Bash", '{"command":"ls"}'),
      messageStop("tool_use"),
      metadata({ inputTokens: 20, outputTokens: 8 }),
    ]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
  });

  test("an empty tool_use input JSON buffer parses as {}", async () => {
    const client = fakeClient([...toolUseBlock(0, "tu_1", "Bash", ""), messageStop("tool_use")]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }]);
  });

  test("maps max_tokens and other stop reasons", async () => {
    const client = fakeClient([messageStop("max_tokens")]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("max_tokens");

    const client2 = fakeClient([messageStop("guardrail_intervened")]);
    const provider2 = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client2);
    const result2 = await provider2.complete(BASE_REQUEST);
    expect(result2.stopReason).toBe("other");
  });

  test("a stream with no messageStop event at all reports 'other'", async () => {
    const client = fakeClient([]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
    expect(result.content).toEqual([]);
  });

  test("skips malformed tool_use blocks missing an id or name", async () => {
    const client = fakeClient([
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: undefined, name: "Bash" } },
        },
      } as unknown as ConverseStreamOutput,
      { contentBlockStop: { contentBlockIndex: 0 } } as unknown as ConverseStreamOutput,
      messageStop("tool_use"),
    ]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([]);
  });

  test("defaults usage to zero when absent from the response", async () => {
    const client = fakeClient([messageStop("end_turn")]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  test("includes cache token usage when present", async () => {
    const client = fakeClient([
      messageStop("end_turn"),
      metadata({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 2,
        cacheWriteInputTokens: 3,
      }),
    ]);
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.usage.cacheReadTokens).toBe(2);
    expect(result.usage.cacheWriteTokens).toBe(3);
  });

  test("sends tool_result content blocks, mapping isError to a status", async () => {
    let captured: ConverseStreamCommand | undefined;
    const client: BedrockClientLike = {
      send: async (command) => {
        captured = command;
        return { stream: streamOf([messageStop("end_turn")]) };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete({
      ...BASE_REQUEST,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "tu_1", content: "ok", isError: true }],
        },
      ],
    });
    expect(captured?.input.messages?.[0]?.content).toEqual([
      { toolResult: { toolUseId: "tu_1", content: [{ text: "ok" }], status: "error" } },
    ]);
  });

  test("omits toolConfig when there are no tools", async () => {
    let captured: ConverseStreamCommand | undefined;
    const client: BedrockClientLike = {
      send: async (command) => {
        captured = command;
        return { stream: streamOf([messageStop("end_turn")]) };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete({ ...BASE_REQUEST, tools: [] });
    expect(captured?.input.toolConfig).toBeUndefined();
  });

  test("a response with no stream at all is treated as an empty turn", async () => {
    const client: BedrockClientLike = { send: async () => ({}) };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      stopReason: "other",
      content: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  describe("DH-0044: streaming callbacks and event ordering", () => {
    test("invokes onTextDelta once per text delta, in order, and accumulates content", async () => {
      const client = fakeClient([
        ...textBlock(0, "hello "),
        {
          contentBlockDelta: { contentBlockIndex: 0, delta: { text: "world" } },
        } as unknown as ConverseStreamOutput,
        { contentBlockStop: { contentBlockIndex: 0 } } as unknown as ConverseStreamOutput,
        messageStop("end_turn"),
      ]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const deltas: string[] = [];
      const callbacks: ProviderStreamCallbacks = { onTextDelta: (t) => deltas.push(t) };
      const result = await provider.complete(BASE_REQUEST, undefined, callbacks);
      expect(deltas).toEqual(["hello ", "world"]);
      expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    });

    test("does not surface tool_use input deltas via onTextDelta", async () => {
      const client = fakeClient([
        ...toolUseBlock(0, "tu_1", "Bash", '{"command":"ls"}'),
        messageStop("tool_use"),
      ]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const deltas: string[] = [];
      await provider.complete(BASE_REQUEST, undefined, { onTextDelta: (t) => deltas.push(t) });
      expect(deltas).toEqual([]);
    });

    test("multiple interleaved text and tool_use blocks are ordered by index in final content", async () => {
      const client = fakeClient([
        ...textBlock(0, "thinking..."),
        ...toolUseBlock(1, "tu_1", "Bash", '{"command":"ls"}'),
        messageStop("tool_use"),
      ]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([
        { type: "text", text: "thinking..." },
        { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
      ]);
    });

    test("a caller that passes no callbacks still works (callbacks fully optional)", async () => {
      const client = fakeClient([...textBlock(0, "fine"), messageStop("end_turn")]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([{ type: "text", text: "fine" }]);
    });
  });

  describe("DH-0044 D6: retry gates on first delta, not before", () => {
    test("a stream that errors before any text delta still retries (existing behavior preserved)", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          if (calls < 2) {
            const err = new Error("slow down");
            err.name = "ThrottlingException";
            throw err;
          }
          return { stream: streamOf([...textBlock(0, "ok"), messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider(
        {
          name: "bedrock",
          type: "bedrock",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([{ type: "text", text: "ok" }]);
      expect(calls).toBe(2);
    });

    test("once a text delta has streamed, a subsequent error in the same attempt is not retried", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          async function* failMidStream(): AsyncGenerator<ConverseStreamOutput> {
            yield* textBlock(0, "partial");
            const err = new Error("stream broke");
            err.name = "ThrottlingException";
            throw err;
          }
          return { stream: failMidStream() };
        },
      };
      const provider = new BedrockProvider(
        {
          name: "bedrock",
          type: "bedrock",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const deltas: string[] = [];
      const err = await provider
        .complete(BASE_REQUEST, undefined, { onTextDelta: (t) => deltas.push(t) })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).retryable).toBe(false);
      expect(deltas).toEqual(["partial"]);
      expect(calls).toBe(1);
    });
  });

  test("wraps SDK failures in ProviderError", async () => {
    const client: BedrockClientLike = {
      send: async () => {
        throw new Error("throttled");
      },
    };
    // maxAttempts: 1 keeps this test instant — a plain Error (no recognizable AWS exception
    // name) classifies as "network"/retryable (see the dedicated DH-0009 retry tests below).
    const provider = new BedrockProvider(
      { name: "bedrock", type: "bedrock", retry: { maxAttempts: 1 } },
      client,
    );
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(ProviderError);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(/throttled/);
  });

  describe("DH-0009: error classification and retry/backoff", () => {
    function errorWithName(name: string, message = "failed"): Error {
      const err = new Error(message);
      err.name = name;
      return err;
    }

    test("classifies AccessDeniedException as auth and never retries", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          throw errorWithName("AccessDeniedException", "nope");
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe("auth");
      expect((err as ProviderError).retryable).toBe(false);
      expect(calls).toBe(1);
    });

    test("classifies ThrottlingException as rate_limit and retries up to maxAttempts", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          throw errorWithName("ThrottlingException", "slow down");
        },
      };
      const provider = new BedrockProvider(
        {
          name: "bedrock",
          type: "bedrock",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("rate_limit");
      expect((err as ProviderError).retryable).toBe(true);
      expect(calls).toBe(3);
    });

    test("classifies ServiceUnavailableException as overloaded and retries", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          throw errorWithName("ServiceUnavailableException", "down");
        },
      };
      const provider = new BedrockProvider(
        {
          name: "bedrock",
          type: "bedrock",
          retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("overloaded");
      expect(calls).toBe(2);
    });

    test("a retry that eventually succeeds returns the successful result", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          if (calls < 2) throw errorWithName("ThrottlingException", "slow down");
          return {
            stream: streamOf([
              ...textBlock(0, "worked eventually"),
              messageStop("end_turn"),
              metadata({ inputTokens: 1, outputTokens: 1 }),
            ]),
          };
        },
      };
      const provider = new BedrockProvider(
        {
          name: "bedrock",
          type: "bedrock",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([{ type: "text", text: "worked eventually" }]);
      expect(calls).toBe(2);
    });

    test("an unrecognized AWS exception name classifies as other and is not retried", async () => {
      let calls = 0;
      const client: BedrockClientLike = {
        send: async () => {
          calls += 1;
          throw errorWithName("ValidationException", "bad request");
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("other");
      expect((err as ProviderError).retryable).toBe(false);
      expect(calls).toBe(1);
    });
  });

  describe("DH-0045: extended thinking", () => {
    function reasoningTextBlock(
      index: number,
      text: string,
      signature: string,
    ): ConverseStreamOutput[] {
      return [
        {
          contentBlockDelta: { contentBlockIndex: index, delta: { reasoningContent: { text } } },
        } as unknown as ConverseStreamOutput,
        {
          contentBlockDelta: {
            contentBlockIndex: index,
            delta: { reasoningContent: { signature } },
          },
        } as unknown as ConverseStreamOutput,
        { contentBlockStop: { contentBlockIndex: index } } as unknown as ConverseStreamOutput,
      ];
    }

    function reasoningRedactedBlock(
      index: number,
      redactedContent: Uint8Array,
    ): ConverseStreamOutput[] {
      return [
        {
          contentBlockDelta: {
            contentBlockIndex: index,
            delta: { reasoningContent: { redactedContent } },
          },
        } as unknown as ConverseStreamOutput,
        { contentBlockStop: { contentBlockIndex: index } } as unknown as ConverseStreamOutput,
      ];
    }

    test("maps reasoningText deltas (text + signature) into a thinking block", async () => {
      const client = fakeClient([
        ...reasoningTextBlock(0, "let me think...", "sig123"),
        ...textBlock(1, "the answer"),
        messageStop("end_turn"),
      ]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([
        { type: "thinking", thinking: "let me think...", signature: "sig123" },
        { type: "text", text: "the answer" },
      ]);
    });

    test("maps redactedContent into a base64-encoded redacted_thinking block", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const client = fakeClient([...reasoningRedactedBlock(0, bytes), messageStop("end_turn")]);
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([
        { type: "redacted_thinking", data: Buffer.from(bytes).toString("base64") },
      ]);
    });

    test("echoes thinking and redacted_thinking blocks back verbatim (byte-identical signature/data)", async () => {
      let captured: ConverseStreamCommand | undefined;
      const client: BedrockClientLike = {
        send: async (command) => {
          captured = command;
          return { stream: streamOf([messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      await provider.complete({
        ...BASE_REQUEST,
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "reasoning text", signature: "sig-abc" },
              { type: "redacted_thinking", data: "cipher-xyz" },
            ],
          },
        ],
      });
      expect(captured?.input.messages?.[0]?.content).toEqual([
        { reasoningContent: { reasoningText: { text: "reasoning text", signature: "sig-abc" } } },
        { reasoningContent: { redactedContent: Buffer.from("cipher-xyz", "base64") } },
      ]);
    });

    test("echoing a thinking block with an empty signature omits the signature field", async () => {
      let captured: ConverseStreamCommand | undefined;
      const client: BedrockClientLike = {
        send: async (command) => {
          captured = command;
          return { stream: streamOf([messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      await provider.complete({
        ...BASE_REQUEST,
        messages: [
          {
            role: "assistant",
            content: [{ type: "thinking", thinking: "reasoning", signature: "" }],
          },
        ],
      });
      expect(captured?.input.messages?.[0]?.content).toEqual([
        { reasoningContent: { reasoningText: { text: "reasoning" } } },
      ]);
    });

    test("passes the thinking param via additionalModelRequestFields when configured (adaptive)", async () => {
      let captured: ConverseStreamCommand | undefined;
      const client: BedrockClientLike = {
        send: async (command) => {
          captured = command;
          return { stream: streamOf([messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      await provider.complete({
        ...BASE_REQUEST,
        thinking: { type: "adaptive", display: "omitted" },
      });
      expect(captured?.input.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive", display: "omitted" },
      });
    });

    test("passes the thinking param via additionalModelRequestFields when configured (enabled)", async () => {
      let captured: ConverseStreamCommand | undefined;
      const client: BedrockClientLike = {
        send: async (command) => {
          captured = command;
          return { stream: streamOf([messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      await provider.complete({
        ...BASE_REQUEST,
        thinking: { type: "enabled", budgetTokens: 2048 },
      });
      expect(captured?.input.additionalModelRequestFields).toEqual({
        thinking: { type: "enabled", budget_tokens: 2048 },
      });
    });

    test("no additionalModelRequestFields is sent when request.thinking is absent", async () => {
      let captured: ConverseStreamCommand | undefined;
      const client: BedrockClientLike = {
        send: async (command) => {
          captured = command;
          return { stream: streamOf([messageStop("end_turn")]) };
        },
      };
      const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
      await provider.complete(BASE_REQUEST);
      expect(captured?.input.additionalModelRequestFields).toBeUndefined();
    });
  });

  test("constructs a real Bedrock SDK client when none is injected", () => {
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock", region: "us-east-1" });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  // Round 3 (docs/handoffs/core.md status log): complete()'s `signal` parameter.
  test("forwards the given AbortSignal to the SDK's send() call as abortSignal", async () => {
    let receivedOptions: { abortSignal?: AbortSignal } | undefined;
    const controller = new AbortController();
    const client: BedrockClientLike = {
      send: async (_command, options) => {
        receivedOptions = options;
        return { stream: streamOf([messageStop("end_turn")]) };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete(BASE_REQUEST, controller.signal);
    expect(receivedOptions?.abortSignal).toBe(controller.signal);
  });

  test("passes no options (rather than {abortSignal: undefined}) when no signal is given", async () => {
    let receivedOptions: { abortSignal?: AbortSignal } | undefined;
    let wasCalled = false;
    const client: BedrockClientLike = {
      send: async (_command, options) => {
        wasCalled = true;
        receivedOptions = options;
        return { stream: streamOf([messageStop("end_turn")]) };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete(BASE_REQUEST);
    expect(wasCalled).toBe(true);
    expect(receivedOptions).toBeUndefined();
  });
});
