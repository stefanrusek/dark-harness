// Common internal provider interface — NOT part of src/contracts/ (that's cross-component
// wire truth; this is internal to how the agent loop talks to whichever SDK a given
// dh.json provider entry resolves to). Both the anthropic and bedrock adapters implement
// this so src/agent/loop.ts is provider-agnostic.

import type { JsonSchema } from "../tools/types.ts";

export type ProviderRole = "user" | "assistant";

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContentBlock[];
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ProviderCompletionRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  maxTokens?: number;
}

export type ProviderStopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderCompletionResult {
  stopReason: ProviderStopReason;
  content: ProviderContentBlock[];
  usage: ProviderUsage;
}

export interface ModelProvider {
  complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResult>;
}

export class ProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
  }
}
