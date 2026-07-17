// OpenAI-compatible provider adapter (DH-0107 architect design — tracking/DH-0107-*.md).
// Speaks the OpenAI Chat Completions API (SSE-streamed) against an operator-supplied
// baseURL + apiKey (bearer token) — structurally the same "custom endpoint" shape as
// anthropic.ts, just OpenAI-message-shaped instead of Anthropic-message-shaped. No SDK
// dependency: the wire surface is thin enough for plain fetch.

import type { ProviderConfig } from "../../contracts/index.ts";
import { withRetry } from "./retry.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderErrorKind,
  ProviderMessage,
  ProviderStopReason,
  ProviderStreamCallbacks,
} from "./types.ts";
import { ProviderError } from "./types.ts";

const DEFAULT_MAX_TOKENS = 8192;

interface OpenAiToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChatMessage {
  role: string;
  content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Minimal fetch-based client seam — lets tests inject a fake without touching the network. */
export interface OpenAiCompatibleClientLike {
  createChatCompletion(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response>;
}

class FetchOpenAiCompatibleClient implements OpenAiCompatibleClientLike {
  constructor(
    private baseURL: string,
    private apiKey: string | undefined,
  ) {}

  async createChatCompletion(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      throw new NetworkFailure(err);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new HttpFailure(response.status, text);
    }
    return response;
  }
}

/** Thrown when the request never reached the endpoint at all (DNS, connection refused, TLS) —
 * mirrors anthropic.ts's `APIConnectionError` distinction (classifyOpenAiCompatibleError below).
 * Exported so tests can inject an `OpenAiCompatibleClientLike` fake that throws these directly,
 * exercising error classification without patching global `fetch`. */
export class NetworkFailure extends Error {
  constructor(public override cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NetworkFailure";
  }
}

export class HttpFailure extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpFailure";
  }
}

function classifyOpenAiCompatibleError(err: unknown): {
  kind: ProviderErrorKind;
  retryable: boolean;
} {
  if (err instanceof HttpFailure) {
    if (err.status === 401 || err.status === 403) return { kind: "auth", retryable: false };
    if (err.status === 429) return { kind: "rate_limit", retryable: true };
    if (err.status >= 500) return { kind: "overloaded", retryable: true };
    return { kind: "other", retryable: false };
  }
  if (err instanceof NetworkFailure) {
    return { kind: "network", retryable: true };
  }
  return { kind: "other", retryable: false };
}

function toOpenAiMessages(system: string, messages: ProviderMessage[]): OpenAiChatMessage[] {
  const result: OpenAiChatMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    const textParts: string[] = [];
    const toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[] =
      [];
    const toolResults: { toolUseId: string; content: string }[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      } else if (block.type === "tool_result") {
        toolResults.push({ toolUseId: block.toolUseId, content: block.content });
      }
    }
    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        ...(textParts.length > 0 ? { content: textParts.join("") } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      if (textParts.length > 0) {
        result.push({ role: "user", content: textParts.join("") });
      }
      for (const toolResult of toolResults) {
        result.push({
          role: "tool",
          tool_call_id: toolResult.toolUseId,
          content: toolResult.content,
        });
      }
    }
  }
  return result;
}

function mapFinishReason(reason: string | null | undefined): ProviderStopReason {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end_turn";
  return "other";
}

export class OpenAiCompatibleProvider implements ModelProvider {
  private client: OpenAiCompatibleClientLike;
  private retryPolicy: ProviderConfig["retry"];

  constructor(config: ProviderConfig, client?: OpenAiCompatibleClientLike) {
    this.client =
      client ??
      new FetchOpenAiCompatibleClient(
        config.baseURL ?? "",
        typeof config.apiKey === "string" ? config.apiKey : undefined,
      );
    this.retryPolicy = config.retry;
  }

  async complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<ProviderCompletionResult> {
    let emittedAny = false;
    let result: ProviderCompletionResult;
    try {
      result = await withRetry(
        async () => {
          const response = await this.client.createChatCompletion(
            {
              model: request.model,
              max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
              stream: true,
              messages: toOpenAiMessages(request.system, request.messages),
              ...(request.tools.length > 0
                ? {
                    tools: request.tools.map((t) => ({
                      type: "function",
                      function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema,
                      },
                    })),
                  }
                : {}),
            },
            signal,
          );
          if (!response.body) {
            throw new Error("openai-compatible provider response had no body");
          }
          return consumeOpenAiCompatibleStream(response.body, callbacks, () => {
            emittedAny = true;
          });
        },
        (err) => !emittedAny && classifyOpenAiCompatibleError(err).retryable,
        this.retryPolicy,
        signal,
      );
    } catch (err) {
      const { kind, retryable } = classifyOpenAiCompatibleError(err);
      throw new ProviderError(
        `openai-compatible provider request failed: ${(err as Error).message}`,
        { cause: err, kind, retryable: retryable && !emittedAny },
      );
    }

    return result;
  }
}

/** Accumulates an SSE `data:` chunk stream of OpenAI Chat Completions `chat.completion.chunk`
 * objects into a complete ProviderCompletionResult. Follows the same accumulator pattern as
 * anthropic.ts's consumeAnthropicStream: text deltas append directly, tool_call argument
 * fragments buffer per index and get JSON.parse'd once the stream ends (chunk boundaries don't
 * align with valid JSON). Terminates on the literal `data: [DONE]` sentinel. */
async function consumeOpenAiCompatibleStream(
  body: ReadableStream<Uint8Array>,
  callbacks: ProviderStreamCallbacks | undefined,
  onFirstDelta: () => void,
): Promise<ProviderCompletionResult> {
  const textParts: string[] = [];
  const toolCalls = new Map<number, { id: string; name: string; argsBuffer: string }>();
  let stopReason: ProviderStopReason = "other";
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;
      const chunk = JSON.parse(payload);
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        onFirstDelta();
        textParts.push(delta.content);
        callbacks?.onTextDelta?.(delta.content);
      }
      if (delta?.tool_calls) {
        for (const call of delta.tool_calls as OpenAiToolCall[]) {
          const index = call.index ?? 0;
          const existing = toolCalls.get(index);
          if (existing) {
            if (call.function?.arguments) existing.argsBuffer += call.function.arguments;
          } else {
            toolCalls.set(index, {
              id: call.id ?? "",
              name: call.function?.name ?? "",
              argsBuffer: call.function?.arguments ?? "",
            });
          }
        }
      }
      if (choice?.finish_reason) {
        stopReason = mapFinishReason(choice.finish_reason);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }
  }

  const content: ProviderContentBlock[] = [];
  if (textParts.length > 0) {
    content.push({ type: "text", text: textParts.join("") });
  }
  for (const [, call] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.argsBuffer.length > 0 ? JSON.parse(call.argsBuffer) : {},
    });
  }

  return {
    stopReason,
    content,
    usage: { inputTokens, outputTokens },
  };
}
