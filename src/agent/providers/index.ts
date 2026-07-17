// Provider factory — builds the right adapter for a ProviderConfig.type (ADR 0007).

import type { ProviderConfig } from "../../contracts/index.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { BedrockProvider } from "./bedrock.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import type { ModelProvider } from "./types.ts";

export function createProvider(config: ProviderConfig): ModelProvider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "bedrock":
      return new BedrockProvider(config);
    case "openai-compatible":
      return new OpenAiCompatibleProvider(config);
  }
}

export * from "./anthropic.ts";
export * from "./bedrock.ts";
export * from "./openai-compatible.ts";
export * from "./types.ts";
