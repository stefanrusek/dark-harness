import { describe, expect, test } from "bun:test";
import {
  HttpFailure,
  NetworkFailure,
  type OpenAiCompatibleClientLike,
  OpenAiCompatibleProvider,
} from "./openai-compatible.ts";
import type { ProviderCompletionRequest, ProviderStreamCallbacks } from "./types.ts";
import { ProviderError } from "./types.ts";

function sseStream(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function sseResponse(chunks: unknown[]): Response {
  return new Response(sseStream(chunks), { status: 200 });
}

function fakeClient(chunks: unknown[]): OpenAiCompatibleClientLike {
  return { createChatCompletion: async () => sseResponse(chunks) };
}

const BASE_REQUEST: ProviderCompletionRequest = {
  model: "google.gemma-4-31b",
  system: "you are a helpful agent",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [
    {
      name: "Bash",
      description: "run a command",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

describe("OpenAiCompatibleProvider", () => {
  test("translates a text response and end_turn stop reason", async () => {
    const client = fakeClient([
      { choices: [{ delta: { content: "hello " } }] },
      { choices: [{ delta: { content: "back" } }] },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    ]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("translates a tool_calls response, accumulating arg fragments by index", async () => {
    const client = fakeClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "tu_1", function: { name: "Bash", arguments: '{"comm' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] } }],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
  });

  test("an empty tool call argument buffer parses as {}", async () => {
    const client = fakeClient([
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "tu_1", function: { name: "Bash" } }] } },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }]);
  });

  test("multiple tool calls stay ordered by index", async () => {
    const client = fakeClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: "tu_2", function: { name: "Read", arguments: "{}" } },
                { index: 0, id: "tu_1", function: { name: "Bash", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "Bash", input: {} },
      { type: "tool_use", id: "tu_2", name: "Read", input: {} },
    ]);
  });

  test("maps length finish_reason to max_tokens", async () => {
    const client = fakeClient([{ choices: [{ delta: {}, finish_reason: "length" }] }]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("max_tokens");
  });

  test("maps an unrecognized finish_reason to 'other'", async () => {
    const client = fakeClient([{ choices: [{ delta: {}, finish_reason: "content_filter" }] }]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
  });

  test("a stream with no finish_reason at all reports 'other'", async () => {
    const client = fakeClient([{ choices: [{ delta: { content: "hi" } }] }]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const result = await provider.complete(BASE_REQUEST);
    expect(result.stopReason).toBe("other");
  });

  test("invokes onTextDelta once per text delta, in order", async () => {
    const client = fakeClient([
      { choices: [{ delta: { content: "hello " } }] },
      { choices: [{ delta: { content: "world" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    const deltas: string[] = [];
    const callbacks: ProviderStreamCallbacks = { onTextDelta: (t) => deltas.push(t) };
    await provider.complete(BASE_REQUEST, undefined, callbacks);
    expect(deltas).toEqual(["hello ", "world"]);
  });

  test("sends system message, assistant tool_calls, and tool-result messages via toOpenAiMessages", async () => {
    let captured: Record<string, unknown> | undefined;
    const client: OpenAiCompatibleClientLike = {
      createChatCompletion: async (body) => {
        captured = body;
        return sseResponse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
      },
    };
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    await provider.complete({
      ...BASE_REQUEST,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking" },
            { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "tu_1", content: "ok", isError: false }],
        },
      ],
    });
    expect(captured?.messages).toEqual([
      { role: "system", content: "you are a helpful agent" },
      {
        role: "assistant",
        content: "thinking",
        // DH-0120: real strict OpenAI-compatible endpoints (Bedrock Mantle) reject
        // tool_calls missing "type": "function" -- caught live, this test previously didn't
        // assert it and would have passed a broken request shape silently.
        tool_calls: [
          {
            id: "tu_1",
            type: "function",
            function: { name: "Bash", arguments: '{"command":"ls"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "tu_1", content: "ok" },
    ]);
    expect(captured?.stream).toBe(true);
    expect(captured?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "Bash",
          description: "run a command",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  test("omits the tools field entirely when no tools are configured", async () => {
    let captured: Record<string, unknown> | undefined;
    const client: OpenAiCompatibleClientLike = {
      createChatCompletion: async (body) => {
        captured = body;
        return sseResponse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
      },
    };
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    await provider.complete({ ...BASE_REQUEST, tools: [] });
    expect(captured?.tools).toBeUndefined();
  });

  test("a user turn with only text content sends a plain user message", async () => {
    let captured: Record<string, unknown> | undefined;
    const client: OpenAiCompatibleClientLike = {
      createChatCompletion: async (body) => {
        captured = body;
        return sseResponse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
      },
    };
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible" },
      client,
    );
    await provider.complete(BASE_REQUEST);
    expect(captured?.messages).toEqual([
      { role: "system", content: "you are a helpful agent" },
      { role: "user", content: "hi" },
    ]);
  });

  test("throws a ProviderError when the response body is missing", async () => {
    const client: OpenAiCompatibleClientLike = {
      createChatCompletion: async () => new Response(null, { status: 200 }),
    };
    const provider = new OpenAiCompatibleProvider(
      { name: "openai-compatible", type: "openai-compatible", retry: { maxAttempts: 1 } },
      client,
    );
    const err = await provider.complete(BASE_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("other");
  });

  describe("error classification", () => {
    // Fake clients throw the exported NetworkFailure/HttpFailure directly — these are the
    // exact error shapes FetchOpenAiCompatibleClient throws on a real request, so this
    // exercises classifyOpenAiCompatibleError without patching global fetch (which races
    // against other test files mutating the same global under bun's parallel test runner).
    test("classifies a 401 as auth and never retries", async () => {
      let calls = 0;
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          calls += 1;
          throw new HttpFailure(401, "bad key");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        { name: "openai-compatible", type: "openai-compatible" },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe("auth");
      expect(err.retryable).toBe(false);
      expect(calls).toBe(1);
    });

    test("classifies a 403 as auth", async () => {
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          throw new HttpFailure(403, "forbidden");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        { name: "openai-compatible", type: "openai-compatible" },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("auth");
    });

    test("classifies a 429 as rate_limit and retries up to maxAttempts", async () => {
      let calls = 0;
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          calls += 1;
          throw new HttpFailure(429, "slow down");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        {
          name: "openai-compatible",
          type: "openai-compatible",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("rate_limit");
      expect(err.retryable).toBe(true);
      expect(calls).toBe(3);
    });

    test("classifies a 5xx as overloaded and retryable", async () => {
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          throw new HttpFailure(503, "oops");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        { name: "openai-compatible", type: "openai-compatible", retry: { maxAttempts: 1 } },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("overloaded");
      expect(err.retryable).toBe(true);
    });

    test("classifies an unrecognized 4xx as other and not retryable", async () => {
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          throw new HttpFailure(400, "bad request");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        { name: "openai-compatible", type: "openai-compatible" },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("other");
      expect(err.retryable).toBe(false);
    });

    test("classifies a network failure (connection never reached the endpoint) as network and retryable", async () => {
      let calls = 0;
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          calls += 1;
          throw new NetworkFailure(new TypeError("fetch failed"));
        },
      };
      const provider = new OpenAiCompatibleProvider(
        {
          name: "openai-compatible",
          type: "openai-compatible",
          retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("network");
      expect(err.retryable).toBe(true);
      expect(calls).toBe(2);
    });

    test("classifies an unrecognized thrown value as other and not retryable", async () => {
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          throw new Error("something odd");
        },
      };
      const provider = new OpenAiCompatibleProvider(
        { name: "openai-compatible", type: "openai-compatible" },
        client,
      );
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err.kind).toBe("other");
      expect(err.retryable).toBe(false);
    });

    test("real FetchOpenAiCompatibleClient: sends no authorization header when apiKey is absent, and one when present", async () => {
      const capturedHeaders: Headers[] = [];
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          capturedHeaders.push(req.headers);
          return new Response(JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
      });
      const baseURL = `http://localhost:${server.port}`;

      const provider = new OpenAiCompatibleProvider({
        name: "openai-compatible",
        type: "openai-compatible",
        baseURL,
        retry: { maxAttempts: 1 },
      });
      await provider.complete(BASE_REQUEST);
      expect(capturedHeaders[0]?.has("authorization")).toBe(false);

      const providerWithKey = new OpenAiCompatibleProvider({
        name: "openai-compatible",
        type: "openai-compatible",
        baseURL,
        apiKey: "secret-key",
        retry: { maxAttempts: 1 },
      });
      await providerWithKey.complete(BASE_REQUEST);
      expect(capturedHeaders[1]?.get("authorization")).toBe("Bearer secret-key");
    });

    test("real FetchOpenAiCompatibleClient: a non-ok response classifies via HttpFailure", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("bad key", { status: 401 });
        },
      });
      const provider = new OpenAiCompatibleProvider({
        name: "openai-compatible",
        type: "openai-compatible",
        baseURL: `http://localhost:${server.port}`,
      });
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe("auth");
    });

    test("real FetchOpenAiCompatibleClient: an unreachable endpoint classifies as network", async () => {
      const provider = new OpenAiCompatibleProvider({
        name: "openai-compatible",
        type: "openai-compatible",
        baseURL: "http://127.0.0.1:1",
        retry: { maxAttempts: 1 },
      });
      const err = await provider.complete(BASE_REQUEST).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe("network");
    });

    test("once a text delta has streamed, a subsequent stream failure is not retried", async () => {
      let calls = 0;
      const client: OpenAiCompatibleClientLike = {
        createChatCompletion: async () => {
          calls += 1;
          const encoder = new TextEncoder();
          let pulls = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
                  ),
                );
                return;
              }
              controller.error(new TypeError("stream broke"));
            },
          });
          return new Response(stream, { status: 200 });
        },
      };
      const provider = new OpenAiCompatibleProvider(
        {
          name: "openai-compatible",
          type: "openai-compatible",
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        },
        client,
      );
      const deltas: string[] = [];
      const err = await provider
        .complete(BASE_REQUEST, undefined, { onTextDelta: (t) => deltas.push(t) })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.retryable).toBe(false);
      expect(deltas).toEqual(["partial"]);
      expect(calls).toBe(1);
    });
  });
});
