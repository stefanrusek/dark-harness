import { describe, expect, test } from "bun:test";
import type { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { type BedrockClientLike, BedrockProvider } from "./bedrock.ts";
import { ProviderError } from "./types.ts";

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
    const client: BedrockClientLike = {
      send: async () => ({
        output: { message: { role: "assistant", content: [{ text: "hello back" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("translates a tool_use response and tool_use stop reason", async () => {
    const client: BedrockClientLike = {
      send: async () => ({
        output: {
          message: {
            role: "assistant",
            content: [{ toolUse: { toolUseId: "tu_1", name: "Bash", input: { command: "ls" } } }],
          },
        },
        stopReason: "tool_use",
        usage: { inputTokens: 20, outputTokens: 8 },
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
  });

  test("maps max_tokens and other stop reasons", async () => {
    const client: BedrockClientLike = {
      send: async () => ({
        output: { message: { role: "assistant", content: [] } },
        stopReason: "max_tokens",
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("max_tokens");

    const client2: BedrockClientLike = {
      send: async () => ({
        output: { message: { role: "assistant", content: [] } },
        stopReason: "guardrail_intervened",
      }),
    };
    const provider2 = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client2);
    const result2 = await provider2.complete(BASE_REQUEST);
    expect(result2.stopReason).toBe("other");
  });

  test("skips malformed tool_use blocks missing an id or name", async () => {
    const client: BedrockClientLike = {
      send: async () => ({
        output: {
          message: {
            role: "assistant",
            content: [{ toolUse: { toolUseId: undefined, name: "Bash", input: {} } }],
          },
        },
        stopReason: "tool_use",
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([]);
  });

  test("defaults usage to zero when absent from the response", async () => {
    const client: BedrockClientLike = {
      send: async () => ({
        output: { message: { role: "assistant", content: [] } },
        stopReason: "end_turn",
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  test("includes cache token usage when present", async () => {
    const client: BedrockClientLike = {
      send: async () => ({
        output: { message: { role: "assistant", content: [] } },
        stopReason: "end_turn",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 2,
          cacheWriteInputTokens: 3,
        },
      }),
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.usage.cacheReadTokens).toBe(2);
    expect(result.usage.cacheWriteTokens).toBe(3);
  });

  test("sends tool_result content blocks, mapping isError to a status", async () => {
    let captured: ConverseCommand | undefined;
    const client: BedrockClientLike = {
      send: async (command) => {
        captured = command;
        return { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" };
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
    let captured: ConverseCommand | undefined;
    const client: BedrockClientLike = {
      send: async (command) => {
        captured = command;
        return { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete({ ...BASE_REQUEST, tools: [] });
    expect(captured?.input.toolConfig).toBeUndefined();
  });

  test("wraps SDK failures in ProviderError", async () => {
    const client: BedrockClientLike = {
      send: async () => {
        throw new Error("throttled");
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(ProviderError);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(/throttled/);
  });

  test("constructs a real Bedrock SDK client when none is injected", () => {
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock", region: "us-east-1" });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  // Round 3 (docs/handoffs/core.md status log): complete()'s new second `signal` parameter.
  test("forwards the given AbortSignal to the SDK's send() call as abortSignal", async () => {
    let receivedOptions: { abortSignal?: AbortSignal } | undefined;
    const controller = new AbortController();
    const client: BedrockClientLike = {
      send: async (_command, options) => {
        receivedOptions = options;
        return { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" };
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
        return { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" };
      },
    };
    const provider = new BedrockProvider({ name: "bedrock", type: "bedrock" }, client);
    await provider.complete(BASE_REQUEST);
    expect(wasCalled).toBe(true);
    expect(receivedOptions).toBeUndefined();
  });
});
