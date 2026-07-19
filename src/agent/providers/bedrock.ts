// Bedrock-type provider adapter (ADR 0007 / HANDOFF.md §5). Wraps AWS Bedrock's Converse API
// via the standard AWS credential chain — no custom credential handling.

import {
  type ContentBlock as BedrockContentBlock,
  BedrockRuntimeClient,
  type Tool as BedrockTool,
  ConverseStreamCommand,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { ProviderConfig } from "../../contracts/index.ts";
import { withRetry } from "./retry.ts";
import {
  type ErrorClassification,
  isContextOverflowMessage,
  mapStopReason,
  withCacheMarkers,
} from "./shared.ts";
import type {
  ModelProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderStopReason,
  ProviderStreamCallbacks,
} from "./types.ts";
import { ProviderError } from "./types.ts";

/** Minimal slice of the Bedrock runtime client this adapter depends on — lets tests inject a
 * fake without touching AWS.
 *
 * DH-0044: `send()` now issues a `ConverseStreamCommand` and returns a `stream` async
 * iterable of `ConverseStreamOutput` union members, rather than `ConverseCommand`'s single
 * whole-response shape. */
export interface BedrockClientLike {
  send(
    command: ConverseStreamCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{
    stream?: AsyncIterable<ConverseStreamOutput>;
  }>;
}

function toBedrockContent(block: ProviderContentBlock): BedrockContentBlock {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "tool_use":
      return {
        toolUse: {
          toolUseId: block.id,
          name: block.name,
          // `input` is an opaque tool-call payload (deserialized from provider-supplied JSON
          // upstream) — genuinely `unknown` on our side, and `DocumentType` (any JSON-shaped
          // value) is exactly what the Bedrock SDK expects there, so this single-field cast
          // isn't masking a shape mismatch the way the old whole-block `as unknown as
          // BedrockContentBlock` casts did.
          input: block.input as DocumentType,
        },
      };
    case "tool_result":
      return {
        toolResult: {
          toolUseId: block.toolUseId,
          content: [{ text: block.content }],
          ...(block.isError !== undefined ? { status: block.isError ? "error" : "success" } : {}),
        },
      };
    case "thinking":
      // DH-0045 §4: reverse of fromBedrockContent's reasoningText mapping — signature is
      // included only when non-empty (Bedrock's ReasoningTextBlock.signature is optional).
      return {
        reasoningContent: {
          reasoningText: {
            text: block.thinking,
            ...(block.signature.length > 0 ? { signature: block.signature } : {}),
          },
        },
      };
    case "redacted_thinking":
      return {
        reasoningContent: {
          redactedContent: Buffer.from(block.data, "base64"),
        },
      };
  }
}

/** DH-0045 §4: Converse has no first-class thinking field; the documented Anthropic-on-
 * Bedrock mechanism is passthrough via `additionalModelRequestFields`, same snake_case wire
 * shape the Anthropic adapter sends directly. */
function toBedrockThinkingField(
  thinking: NonNullable<ProviderCompletionRequest["thinking"]>,
): Record<string, unknown> {
  if (thinking.type === "adaptive") {
    return {
      type: "adaptive",
      ...(thinking.display !== undefined ? { display: thinking.display } : {}),
    };
  }
  return {
    type: "enabled",
    budget_tokens: thinking.budgetTokens,
    ...(thinking.display !== undefined ? { display: thinking.display } : {}),
  };
}

/** DH-0010 Part A: mirrors anthropic.ts's `withAnthropicCacheMarkers` — appends a
 * `{ cachePoint: { type: "default" } }` content block (rather than annotating the existing
 * last block, since Converse's cache point is its own trailing content block, not an
 * annotation) to the final message's content and to the second-to-last user message's
 * content, if one exists. Never mutates the input. */
function withBedrockCacheMarkers(
  messages: { role: "user" | "assistant"; content: BedrockContentBlock[] }[],
): { role: "user" | "assistant"; content: BedrockContentBlock[] }[] {
  const cachePoint: BedrockContentBlock = { cachePoint: { type: "default" } };
  return withCacheMarkers(messages, (content) => [...content, cachePoint]);
}

// DH-0009: AWS SDK errors carry a `.name` (the exception shape name) rather than an HTTP
// status directly on the error object — these are the Bedrock Converse API's own documented
// exception names for the relevant categories.
const RATE_LIMIT_ERROR_NAMES = Object.freeze(
  new Set(["ThrottlingException", "TooManyRequestsException"]),
);
const OVERLOADED_ERROR_NAMES = Object.freeze(
  new Set([
    "ServiceUnavailableException",
    "InternalServerException",
    "ModelTimeoutException",
    "ModelNotReadyException",
  ]),
);
const AUTH_ERROR_NAMES = Object.freeze(
  new Set(["AccessDeniedException", "UnrecognizedClientException", "ExpiredTokenException"]),
);

// DH-0009: classifies a raw thrown value from the Bedrock SDK by its exception name; a
// plain error with no recognizable AWS exception name (e.g. a network-level failure that
// never reached AWS at all) is treated as `network` (retryable), matching the same
// "no status/name at all means it never reached the service" logic anthropic.ts uses.
// DH-0010 Part B: best-effort detection of Bedrock's "the request was too long" — mirrors
// anthropic.ts's `isContextOverflowMessage`, same fragile-but-graceful-degradation rationale.
const CONTEXT_OVERFLOW_MESSAGE_PATTERN = /input is too long/i;

function classifyBedrockError(err: unknown): ErrorClassification {
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === "string") {
    if (RATE_LIMIT_ERROR_NAMES.has(name)) return { kind: "rate_limit", retryable: true };
    if (OVERLOADED_ERROR_NAMES.has(name)) return { kind: "overloaded", retryable: true };
    if (AUTH_ERROR_NAMES.has(name)) return { kind: "auth", retryable: false };
    if (
      name === "ValidationException" &&
      isContextOverflowMessage((err as Error).message ?? "", CONTEXT_OVERFLOW_MESSAGE_PATTERN)
    ) {
      return { kind: "context_overflow", retryable: false };
    }
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
      new BedrockRuntimeClient({
        ...(typeof config.region === "string" ? { region: config.region } : {}),
        // DH-0009: the AWS SDK's own default retry behavior (maxAttempts: 3 total attempts)
        // would otherwise compound with this adapter's own withRetry below, the same
        // double-retry bug found (and fixed the same way) in anthropic.ts — see that
        // adapter's constructor for the full explanation. maxAttempts: 1 means exactly one
        // real attempt per call; this adapter owns all retry/backoff.
        maxAttempts: 1,
      });
    this.retryPolicy = config.retry;
  }

  async complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<ProviderCompletionResult> {
    const tools: BedrockTool[] = request.tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        // `JsonSchema` (src/agent/tools/types.ts) has no index signature, so it doesn't
        // structurally overlap with `DocumentType`'s `{ [prop: string]: DocumentType }` even
        // though every JsonSchema value is itself valid JSON — genuinely two different shapes
        // for the same runtime data, hence the through-`unknown` cast rather than a direct one.
        inputSchema: { json: t.inputSchema as unknown as DocumentType },
      },
    }));

    // DH-0044 D6: retry only until the first text delta actually reaches the caller — see
    // anthropic.ts's identical `emittedAny` closure for the full rationale.
    let emittedAny = false;
    let result: ProviderCompletionResult;
    try {
      result = await withRetry(
        async () => {
          const rawMessages = request.messages.map((m) => ({
            role: m.role,
            content: m.content.map(toBedrockContent),
          }));
          const response = await this.client.send(
            new ConverseStreamCommand({
              modelId: request.model,
              // DH-0010 Part A: system gains a trailing cachePoint block only when
              // `request.cache` is true — false/absent keeps the plain single-text-block
              // form, byte-identical to pre-DH-0010 requests.
              system: request.cache
                ? [{ text: request.system }, { cachePoint: { type: "default" } }]
                : [{ text: request.system }],
              messages: request.cache ? withBedrockCacheMarkers(rawMessages) : rawMessages,
              ...(tools.length > 0 ? { toolConfig: { tools } } : {}),
              ...(request.thinking !== undefined
                ? {
                    additionalModelRequestFields: {
                      thinking: toBedrockThinkingField(request.thinking),
                    } as DocumentType,
                  }
                : {}),
            }),
            signal ? { abortSignal: signal } : undefined,
          );
          return consumeBedrockStream(response.stream, callbacks, () => {
            emittedAny = true;
          });
        },
        (err) => !emittedAny && classifyBedrockError(err).retryable,
        this.retryPolicy,
        signal,
      );
    } catch (err) {
      const { kind, retryable } = classifyBedrockError(err);
      throw new ProviderError(`bedrock provider request failed: ${(err as Error).message}`, {
        cause: err,
        kind,
        retryable: retryable && !emittedAny,
      });
    }

    return result;
  }
}

/** DH-0044 D4: accumulates a Bedrock `ConverseStreamOutput` async iterable into a complete
 * `ProviderCompletionResult`, invoking `callbacks.onTextDelta` for each text delta and
 * `onFirstDelta` the first time any *text* delta is observed (gates retry — see D6, mirrors
 * anthropic.ts's identical convention). Unlike Anthropic, Bedrock has no explicit block-start
 * event for *text* blocks — a `contentBlockDelta` with `delta.text` at an unseen index
 * implicitly opens the accumulator. */
async function consumeBedrockStream(
  stream: AsyncIterable<ConverseStreamOutput> | undefined,
  callbacks: ProviderStreamCallbacks | undefined,
  onFirstDelta: () => void,
): Promise<ProviderCompletionResult> {
  if (!stream) {
    // No stream at all (a fake/misbehaving client) — treat as a whole-turn no-op result;
    // callers see zero deltas and no content, same shape a genuinely empty turn would produce.
    return { stopReason: "other", content: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const blocks = new Map<number, { type: "text"; text: string } | ProviderContentBlock>();
  const toolJsonBuffers = new Map<number, string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let stopReason: ProviderStopReason = "other";

  for await (const event of stream) {
    if (event.contentBlockStart) {
      const { contentBlockIndex, start } = event.contentBlockStart;
      if (contentBlockIndex === undefined) continue;
      if (start?.toolUse) {
        const { toolUseId, name } = start.toolUse;
        if (toolUseId && name) {
          blocks.set(contentBlockIndex, { type: "tool_use", id: toolUseId, name, input: {} });
          toolJsonBuffers.set(contentBlockIndex, "");
        }
      }
      // No accumulator opened for an unrecognized/unsupported block-start kind (e.g. image)
      // — finalized as skipped at contentBlockStop, same as fromBedrockContent's existing
      // null-for-unrecognized-block handling. reasoningContent (DH-0045) has no explicit
      // block-start either — like text, it's implicitly opened by its first delta below.
    } else if (event.contentBlockDelta) {
      const { contentBlockIndex, delta } = event.contentBlockDelta;
      if (contentBlockIndex === undefined || !delta) continue;
      if (delta.text !== undefined) {
        onFirstDelta();
        const existing = blocks.get(contentBlockIndex);
        if (existing && existing.type === "text") {
          existing.text += delta.text;
        } else if (!existing) {
          // Bedrock has no explicit text block-start — first text delta at an unseen index
          // implicitly opens the accumulator.
          blocks.set(contentBlockIndex, { type: "text", text: delta.text });
        }
        callbacks?.onTextDelta?.(delta.text);
      } else if (delta.toolUse?.input !== undefined) {
        const buffered = toolJsonBuffers.get(contentBlockIndex);
        if (buffered !== undefined) {
          toolJsonBuffers.set(contentBlockIndex, buffered + delta.toolUse.input);
        }
      } else if (delta.reasoningContent !== undefined) {
        // DH-0045 §4: `ContentBlock.reasoningContent` union — `text`/`signature` deltas
        // accumulate a `thinking` block; `redactedContent` arrives whole in one delta and
        // maps straight to a `redacted_thinking` block (base64-encoded, mirroring
        // fromAnthropicContent's redacted_thinking handling).
        const reasoning = delta.reasoningContent;
        if (reasoning.text !== undefined) {
          const existing = blocks.get(contentBlockIndex);
          if (existing && existing.type === "thinking") {
            existing.thinking += reasoning.text;
          } else if (!existing) {
            blocks.set(contentBlockIndex, {
              type: "thinking",
              thinking: reasoning.text,
              signature: "",
            });
          }
        } else if (reasoning.signature !== undefined) {
          const existing = blocks.get(contentBlockIndex);
          if (existing && existing.type === "thinking") {
            existing.signature += reasoning.signature;
          } else if (!existing) {
            blocks.set(contentBlockIndex, {
              type: "thinking",
              thinking: "",
              signature: reasoning.signature,
            });
          }
        } else if (reasoning.redactedContent !== undefined) {
          blocks.set(contentBlockIndex, {
            type: "redacted_thinking",
            data: Buffer.from(reasoning.redactedContent).toString("base64"),
          });
        }
      }
    } else if (event.contentBlockStop) {
      const { contentBlockIndex } = event.contentBlockStop;
      if (contentBlockIndex === undefined) continue;
      const buffered = toolJsonBuffers.get(contentBlockIndex);
      if (buffered !== undefined) {
        const block = blocks.get(contentBlockIndex);
        if (block && block.type === "tool_use") {
          block.input = buffered.length > 0 ? JSON.parse(buffered) : {};
        }
      }
    } else if (event.messageStop) {
      stopReason = mapStopReason(event.messageStop.stopReason);
    } else if (event.metadata) {
      const { usage } = event.metadata;
      inputTokens = usage?.inputTokens ?? 0;
      outputTokens = usage?.outputTokens ?? 0;
      if (usage?.cacheReadInputTokens != null) cacheReadTokens = usage.cacheReadInputTokens;
      if (usage?.cacheWriteInputTokens != null) cacheWriteTokens = usage.cacheWriteInputTokens;
    }
    // messageStart carries only the role — nothing to accumulate.
  }

  const content = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) => block as ProviderContentBlock);

  return {
    stopReason,
    content,
    usage: {
      inputTokens,
      outputTokens,
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    },
  };
}
