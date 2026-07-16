import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { type AnthropicClientLike, AnthropicProvider } from "./anthropic.ts";
import type { ProviderStreamCallbacks } from "./types.ts";
import { ProviderError } from "./types.ts";

// DH-0044: both adapters now always request streaming, so every fixture here is a fake
// async-iterable of raw `Anthropic.RawMessageStreamEvent`s rather than a single whole
// `Anthropic.Message` — see anthropic.ts's `AnthropicClientLike` doc comment for why (no
// `MessageStream` class to fake, tests inject a plain async generator).

async function* streamOf(
  events: Anthropic.RawMessageStreamEvent[],
): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

function messageStart(usage: Partial<Anthropic.Usage> = {}): Anthropic.RawMessageStreamEvent {
  return {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "sonnet-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, ...usage } as Anthropic.Usage,
    },
  } as unknown as Anthropic.RawMessageStreamEvent;
}

function textBlock(index: number, text: string): Anthropic.RawMessageStreamEvent[] {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "", citations: null },
    } as unknown as Anthropic.RawMessageStreamEvent,
    {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    } as unknown as Anthropic.RawMessageStreamEvent,
    { type: "content_block_stop", index } as unknown as Anthropic.RawMessageStreamEvent,
  ];
}

function toolUseBlock(
  index: number,
  id: string,
  name: string,
  inputJson: string,
): Anthropic.RawMessageStreamEvent[] {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id, name, input: {} },
    } as unknown as Anthropic.RawMessageStreamEvent,
    {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: inputJson },
    } as unknown as Anthropic.RawMessageStreamEvent,
    { type: "content_block_stop", index } as unknown as Anthropic.RawMessageStreamEvent,
  ];
}

function messageDelta(
  stopReason: Anthropic.Message["stop_reason"],
  outputTokens: number,
): Anthropic.RawMessageStreamEvent {
  return {
    type: "message_delta",
    delta: { container: null, stop_details: null, stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens } as Anthropic.MessageDeltaUsage,
  } as unknown as Anthropic.RawMessageStreamEvent;
}

const messageStop = { type: "message_stop" } as unknown as Anthropic.RawMessageStreamEvent;

function fakeClient(events: Anthropic.RawMessageStreamEvent[]): AnthropicClientLike {
  return { messages: { create: async () => streamOf(events) } };
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
    const client = fakeClient([
      messageStart({ input_tokens: 10 }),
      ...textBlock(0, "hello back"),
      messageDelta("end_turn", 5),
      messageStop,
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("translates a tool_use response and tool_use stop reason", async () => {
    const client = fakeClient([
      messageStart({ input_tokens: 20 }),
      ...toolUseBlock(0, "tu_1", "Bash", '{"command":"ls"}'),
      messageDelta("tool_use", 8),
      messageStop,
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
  });

  test("an empty tool_use input JSON buffer parses as {}", async () => {
    const client = fakeClient([
      messageStart(),
      ...toolUseBlock(0, "tu_1", "Bash", ""),
      messageDelta("tool_use", 1),
      messageStop,
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }]);
  });

  test("maps max_tokens stop reason", async () => {
    const client = fakeClient([messageStart(), messageDelta("max_tokens", 1), messageStop]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("max_tokens");
  });

  test("maps any other stop reason (e.g. stop_sequence) to 'other'", async () => {
    const client = fakeClient([messageStart(), messageDelta("stop_sequence", 1), messageStop]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
  });

  test("a stream with no message_delta stop_reason (only message_stop) reports 'other'", async () => {
    const client = fakeClient([messageStart(), messageStop]);
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
  });

  test("includes cache token usage when present", async () => {
    const client = fakeClient([
      messageStart({ input_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
      messageDelta("end_turn", 1),
      messageStop,
    ]);
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
          return streamOf([messageStart(), messageDelta("end_turn", 1), messageStop]);
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
    expect((captured as Anthropic.MessageCreateParamsStreaming).messages[0]?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false },
    ]);
    expect((captured as Anthropic.MessageCreateParamsStreaming).stream).toBe(true);
  });

  describe("DH-0044: streaming callbacks and event ordering", () => {
    test("invokes onTextDelta once per text delta, in order, and accumulates content", async () => {
      const client = fakeClient([
        messageStart({ input_tokens: 1 }),
        ...textBlock(0, "hello "),
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "world" },
        } as unknown as Anthropic.RawMessageStreamEvent,
        messageDelta("end_turn", 2),
        messageStop,
      ]);
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const deltas: string[] = [];
      const callbacks: ProviderStreamCallbacks = { onTextDelta: (t) => deltas.push(t) };
      const result = await provider.complete(BASE_REQUEST, undefined, callbacks);
      // textBlock() itself emits one delta ("hello "), plus the extra "world" delta above.
      expect(deltas).toEqual(["hello ", "world"]);
      expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    });

    test("does not surface tool_use input_json_delta via onTextDelta", async () => {
      const client = fakeClient([
        messageStart(),
        ...toolUseBlock(0, "tu_1", "Bash", '{"command":"ls"}'),
        messageDelta("tool_use", 1),
        messageStop,
      ]);
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const deltas: string[] = [];
      await provider.complete(BASE_REQUEST, undefined, { onTextDelta: (t) => deltas.push(t) });
      expect(deltas).toEqual([]);
    });

    test("multiple interleaved text and tool_use blocks are ordered by index in final content", async () => {
      const client = fakeClient([
        messageStart(),
        ...textBlock(0, "thinking..."),
        ...toolUseBlock(1, "tu_1", "Bash", '{"command":"ls"}'),
        messageDelta("tool_use", 1),
        messageStop,
      ]);
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([
        { type: "text", text: "thinking..." },
        { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
      ]);
    });

    test("a provider caller that passes no callbacks still works (callbacks fully optional)", async () => {
      const client = fakeClient([
        messageStart(),
        ...textBlock(0, "fine"),
        messageDelta("end_turn", 1),
        messageStop,
      ]);
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([{ type: "text", text: "fine" }]);
    });
  });

  describe("DH-0044 D6: retry gates on first delta, not before", () => {
    test("a stream that errors before any text delta still retries (existing behavior preserved)", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            if (calls < 2) {
              const err = new Error("slow down") as Error & { status: number };
              err.status = 429;
              throw err;
            }
            return streamOf([
              messageStart(),
              ...textBlock(0, "ok"),
              messageDelta("end_turn", 1),
              messageStop,
            ]);
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
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
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            // Simulates a stream that produced one delta then failed mid-generator.
            async function* failMidStream(): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
              yield messageStart();
              yield* textBlock(0, "partial");
              const err = new Error("stream broke") as Error & { status: number };
              err.status = 429;
              throw err;
            }
            return failMidStream();
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
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
      // Exactly one real attempt — retrying after a delta streamed would duplicate the
      // already-displayed "partial" text.
      expect(calls).toBe(1);
    });
  });

  test("wraps SDK failures in ProviderError", async () => {
    const client: AnthropicClientLike = {
      messages: {
        create: async () => {
          throw new Error("network down");
        },
      },
    };
    // maxAttempts: 1 keeps this test instant — a plain Error (no `.status`) classifies as
    // "network"/retryable (see the dedicated DH-0009 retry tests below), which would
    // otherwise make this test wait through real backoff delays for no reason.
    const provider = new AnthropicProvider(
      { name: "anthropic", type: "anthropic", retry: { maxAttempts: 1 } },
      client,
    );
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(ProviderError);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(/network down/);
  });

  describe("DH-0009: error classification and retry/backoff", () => {
    function errorWithStatus(status: number, message = "failed"): Error {
      const err = new Error(message);
      (err as unknown as { status: number }).status = status;
      return err;
    }

    test("classifies a 401/403 as auth and never retries", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            throw errorWithStatus(401, "bad key");
          },
        },
      };
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe("auth");
      expect((err as ProviderError).retryable).toBe(false);
      expect(calls).toBe(1);
    });

    test("classifies a 429 as rate_limit and retries up to maxAttempts", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            throw errorWithStatus(429, "slow down");
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("rate_limit");
      expect((err as ProviderError).retryable).toBe(true);
      expect(calls).toBe(3);
    });

    test("classifies a 5xx as overloaded and retries", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            throw errorWithStatus(503, "overloaded");
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
          retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("overloaded");
      expect(calls).toBe(2);
    });

    test("a retry that eventually succeeds returns the successful result, not an error", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            if (calls < 2) throw errorWithStatus(429, "slow down");
            return streamOf([
              messageStart(),
              ...textBlock(0, "worked eventually"),
              messageDelta("end_turn", 1),
              messageStop,
            ]);
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const result = await provider.complete(BASE_REQUEST);
      expect(result.content).toEqual([{ type: "text", text: "worked eventually" }]);
      expect(calls).toBe(2);
    });

    test("a genuine connection failure (unreachable host) classifies as network and retries", async () => {
      const provider = new AnthropicProvider({
        name: "anthropic",
        type: "anthropic",
        baseURL: "http://127.0.0.1:1",
        apiKey: "sk-test",
        retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
      });
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe("network");
      expect((err as ProviderError).retryable).toBe(true);
    });

    // DH-0044: the pre-streaming version of this test served a malformed non-JSON body and
    // asserted `messages.create()` itself threw a JSON.parse SyntaxError. Under streaming,
    // the SDK decodes an SSE event stream rather than parsing one JSON body — a garbled body
    // with no `data:`/`event:` framing is read as an empty event stream, not a parse error
    // (confirmed empirically: it no longer throws at all). The scenario this test actually
    // exists to cover — "a thrown value with no `.status` and no `APIConnectionError` marker
    // classifies as `other`, not `network`" — is still real and still needs coverage, so it's
    // rewritten against a fake client that throws exactly that shape directly, rather than
    // trying to coerce the real SDK into throwing via a malformed HTTP response.
    test("a thrown SyntaxError with no status classifies as other, not network, and is not retried", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            throw new SyntaxError("Unexpected token in JSON");
          },
        },
      };
      const provider = new AnthropicProvider(
        {
          name: "anthropic",
          type: "anthropic",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe("other");
      expect((err as ProviderError).retryable).toBe(false);
      expect(calls).toBe(1);
    });

    test("a 4xx other than 401/403/429 classifies as other and is not retried", async () => {
      let calls = 0;
      const client: AnthropicClientLike = {
        messages: {
          create: async () => {
            calls += 1;
            throw errorWithStatus(400, "bad request");
          },
        },
      };
      const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect((err as ProviderError).kind).toBe("other");
      expect((err as ProviderError).retryable).toBe(false);
      expect(calls).toBe(1);
    });
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

  // Round 3 (docs/handoffs/core.md status log): complete()'s `signal` parameter — end-to-end
  // proof that it actually reaches the underlying SDK call lives in runtime.test.ts's
  // "stopRoot() aborts a running root loop's in-flight provider call" (a real never-
  // responding HTTP server + a real abort); these two are the adapter-local unit-level check
  // that the exact signal object is forwarded, not dropped or copied.
  test("forwards the given AbortSignal to the SDK's create() call as its second argument", async () => {
    let receivedOptions: { signal?: AbortSignal } | undefined;
    const controller = new AbortController();
    const client: AnthropicClientLike = {
      messages: {
        create: async (_params, options) => {
          receivedOptions = options;
          return streamOf([messageStart(), messageDelta("end_turn", 1), messageStop]);
        },
      },
    };
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    await provider.complete(BASE_REQUEST, controller.signal);
    expect(receivedOptions?.signal).toBe(controller.signal);
  });

  test("passes no options (rather than {signal: undefined}) when no signal is given", async () => {
    let receivedOptions: { signal?: AbortSignal } | undefined;
    let wasCalled = false;
    const client: AnthropicClientLike = {
      messages: {
        create: async (_params, options) => {
          wasCalled = true;
          receivedOptions = options;
          return streamOf([messageStart(), messageDelta("end_turn", 1), messageStop]);
        },
      },
    };
    const provider = new AnthropicProvider({ name: "anthropic", type: "anthropic" }, client);
    await provider.complete(BASE_REQUEST);
    expect(wasCalled).toBe(true);
    expect(receivedOptions).toBeUndefined();
  });
});
