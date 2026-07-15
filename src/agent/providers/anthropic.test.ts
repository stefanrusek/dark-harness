import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { type AnthropicClientLike, AnthropicProvider } from "./anthropic.ts";
import { ProviderError } from "./types.ts";

function fakeClient(response: Anthropic.Message): AnthropicClientLike {
  return { messages: { create: async () => response } };
}

const BASE_REQUEST = {
  model: "sonnet-5",
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

describe("AnthropicProvider", () => {
  test("translates a text response and end_turn stop reason", async () => {
    const client = fakeClient({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [{ type: "text", text: "hello back", citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    } as unknown as Anthropic.Message);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("translates a tool_use response and tool_use stop reason", async () => {
    const client = fakeClient({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 8 } as Anthropic.Usage,
    } as unknown as Anthropic.Message);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
  });

  test("maps max_tokens stop reason", async () => {
    const client = fakeClient({
      id: "msg_3",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [],
      stop_reason: "max_tokens",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
    } as unknown as Anthropic.Message);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("max_tokens");
  });

  test("maps any other stop reason (e.g. stop_sequence) to 'other'", async () => {
    const client = fakeClient({
      id: "msg_4",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [],
      stop_reason: "stop_sequence",
      stop_sequence: "STOP",
      usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
    } as unknown as Anthropic.Message);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
  });

  test("includes cache token usage when present", async () => {
    const client = fakeClient({
      id: "msg_5",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      } as Anthropic.Usage,
    } as unknown as Anthropic.Message);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.usage.cacheReadTokens).toBe(3);
    expect(result.usage.cacheWriteTokens).toBe(4);
  });

  test("sends tool_result content blocks from prior turns", async () => {
    let captured: unknown;
    const client: AnthropicClientLike = {
      messages: {
        create: async (params) => {
          captured = params;
          return {
            id: "msg_6",
            type: "message",
            role: "assistant",
            model: "sonnet-5",
            content: [],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
          } as unknown as Anthropic.Message;
        },
      },
    };
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    await provider.complete({
      ...BASE_REQUEST,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "tu_1", content: "ok", isError: false }],
        },
      ],
    });
    expect((captured as Anthropic.MessageCreateParamsNonStreaming).messages[0]?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false },
    ]);
  });

  test("wraps SDK failures in ProviderError", async () => {
    const client: AnthropicClientLike = {
      messages: {
        create: async () => {
          throw new Error("network down");
        },
      },
    };
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(ProviderError);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(/network down/);
  });

  test("constructs a real Anthropic SDK client when none is injected (baseURL/apiKey wiring)", () => {
    // No network call is made here — only verifies construction doesn't throw when the
    // adapter builds its own client from a ProviderConfig (e.g. the "local" provider).
    const provider = new AnthropicProvider({
      name: "local",
      type: "anthropic",
      baseURL: "http://localhost:4000",
      apiKey: "sk-test",
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });
});
