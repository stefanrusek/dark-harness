// Anthropic-type provider adapter (ADR 0007 / HANDOFF.md §5). Wraps the Anthropic SDK;
// accepts a custom baseURL so the "local" provider entry in the sample config can point at
// any Anthropic-compatible endpoint using this same adapter.

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "../../contracts/index.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderStopReason,
} from "./types.ts";
import { ProviderError } from "./types.ts";

const DEFAULT_MAX_TOKENS = 8192;

/** Minimal slice of the Anthropic SDK client this adapter depends on — lets tests inject a
 * fake without touching the network. */
export interface AnthropicClientLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

function toAnthropicContent(block: ProviderContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError !== undefined ? { is_error: block.isError } : {}),
      };
  }
}

function fromAnthropicContent(block: Anthropic.ContentBlock): ProviderContentBlock | null {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "tool_use") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  }
  return null;
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): ProviderStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn") return "end_turn";
  return "other";
}

export class AnthropicProvider implements ModelProvider {
  private client: AnthropicClientLike;

  constructor(config: ProviderConfig, client?: AnthropicClientLike) {
    this.client =
      client ??
      new Anthropic({
        apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
        baseURL: config.baseURL,
      });
  }

  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: request.model,
        system: request.system,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content.map(toAnthropicContent),
        })),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
      });
    } catch (err) {
      throw new ProviderError(`anthropic provider request failed: ${(err as Error).message}`, {
        cause: err,
      });
    }

    const content = response.content
      .map(fromAnthropicContent)
      .filter((b): b is ProviderContentBlock => b !== null);

    return {
      stopReason: mapStopReason(response.stop_reason),
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ...(response.usage.cache_read_input_tokens != null
          ? { cacheReadTokens: response.usage.cache_read_input_tokens }
          : {}),
        ...(response.usage.cache_creation_input_tokens != null
          ? { cacheWriteTokens: response.usage.cache_creation_input_tokens }
          : {}),
      },
    };
  }
}
