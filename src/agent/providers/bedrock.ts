// Bedrock-type provider adapter (ADR 0007 / HANDOFF.md §5). Wraps AWS Bedrock's Converse API
// via the standard AWS credential chain — no custom credential handling.

import {
  type ContentBlock as BedrockContentBlock,
  type Message as BedrockMessage,
  BedrockRuntimeClient,
  type StopReason as BedrockStopReason,
  type Tool as BedrockTool,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { ProviderConfig } from "../../contracts/index.ts";
import { withRetry } from "./retry.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderErrorKind,
  ProviderStopReason,
} from "./types.ts";
import { ProviderError } from "./types.ts";

/** Minimal slice of the Bedrock runtime client this adapter depends on — lets tests inject a
 * fake without touching AWS. */
export interface BedrockClientLike {
  send(
    command: ConverseCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{
    output?: { message?: BedrockMessage };
    stopReason?: BedrockStopReason;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheWriteInputTokens?: number;
    };
  }>;
}

function toBedrockContent(block: ProviderContentBlock): BedrockContentBlock {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "tool_use":
      return {
        toolUse: { toolUseId: block.id, name: block.name, input: block.input },
      } as unknown as BedrockContentBlock;
    case "tool_result":
      return {
        toolResult: {
          toolUseId: block.toolUseId,
          content: [{ text: block.content }],
          ...(block.isError !== undefined ? { status: block.isError ? "error" : "success" } : {}),
        },
      };
  }
}

function fromBedrockContent(block: BedrockContentBlock): ProviderContentBlock | null {
  if (block.text !== undefined) {
    return { type: "text", text: block.text };
  }
  if (block.toolUse) {
    const { toolUseId, name, input } = block.toolUse;
    if (!toolUseId || !name) return null;
    return { type: "tool_use", id: toolUseId, name, input };
  }
  return null;
}

function mapStopReason(reason: BedrockStopReason | undefined): ProviderStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn") return "end_turn";
  return "other";
}

// DH-0009: AWS SDK errors carry a `.name` (the exception shape name) rather than an HTTP
// status directly on the error object — these are the Bedrock Converse API's own documented
// exception names for the relevant categories.
const RATE_LIMIT_ERROR_NAMES = new Set(["ThrottlingException", "TooManyRequestsException"]);
const OVERLOADED_ERROR_NAMES = new Set([
  "ServiceUnavailableException",
  "InternalServerException",
  "ModelTimeoutException",
  "ModelNotReadyException",
]);
const AUTH_ERROR_NAMES = new Set([
  "AccessDeniedException",
  "UnrecognizedClientException",
  "ExpiredTokenException",
]);

/** DH-0009: classifies a raw thrown value from the Bedrock SDK by its exception name; a
 * plain error with no recognizable AWS exception name (e.g. a network-level failure that
 * never reached AWS at all) is treated as `network` (retryable), matching the same
 * "no status/name at all means it never reached the service" logic anthropic.ts uses. */
function classifyBedrockError(err: unknown): { kind: ProviderErrorKind; retryable: boolean } {
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === "string") {
    if (RATE_LIMIT_ERROR_NAMES.has(name)) return { kind: "rate_limit", retryable: true };
    if (OVERLOADED_ERROR_NAMES.has(name)) return { kind: "overloaded", retryable: true };
    if (AUTH_ERROR_NAMES.has(name)) return { kind: "auth", retryable: false };
    if (name !== "Error" && name !== "TypeError") return { kind: "other", retryable: false };
  }
  return { kind: "network", retryable: true };
}

export class BedrockProvider implements ModelProvider {
  private client: BedrockClientLike;
  private retryPolicy: ProviderConfig["retry"];

  constructor(config: ProviderConfig, client?: BedrockClientLike) {
    this.client =
      client ??
      new BedrockRuntimeClient(typeof config.region === "string" ? { region: config.region } : {});
    this.retryPolicy = config.retry;
  }

  async complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const tools: BedrockTool[] = request.tools.map(
      (t) =>
        ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        }) as unknown as BedrockTool,
    );

    let response: Awaited<ReturnType<BedrockClientLike["send"]>>;
    try {
      response = await withRetry(
        () =>
          this.client.send(
            new ConverseCommand({
              modelId: request.model,
              system: [{ text: request.system }],
              messages: request.messages.map((m) => ({
                role: m.role,
                content: m.content.map(toBedrockContent),
              })),
              ...(tools.length > 0 ? { toolConfig: { tools } } : {}),
            }),
            signal ? { abortSignal: signal } : undefined,
          ),
        (err) => classifyBedrockError(err).retryable,
        this.retryPolicy,
        signal,
      );
    } catch (err) {
      const { kind, retryable } = classifyBedrockError(err);
      throw new ProviderError(`bedrock provider request failed: ${(err as Error).message}`, {
        cause: err,
        kind,
        retryable,
      });
    }

    const rawContent = response.output?.message?.content ?? [];
    const content = rawContent
      .map(fromBedrockContent)
      .filter((b): b is ProviderContentBlock => b !== null);

    return {
      stopReason: mapStopReason(response.stopReason),
      content,
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
        ...(response.usage?.cacheReadInputTokens != null
          ? { cacheReadTokens: response.usage.cacheReadInputTokens }
          : {}),
        ...(response.usage?.cacheWriteInputTokens != null
          ? { cacheWriteTokens: response.usage.cacheWriteInputTokens }
          : {}),
      },
    };
  }
}
