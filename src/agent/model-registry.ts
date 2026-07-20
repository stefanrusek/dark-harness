// DH-0173: extracted from AgentRuntime — model-name/provider resolution against a fixed
// DhConfig, plus the per-provider-name provider cache (created lazily, one instance per
// distinct `model.provider` name for the runtime's whole lifetime). Behavior-preserving:
// same lazy-create-and-cache semantics, same error types/messages as before.

import type { DhConfig, ModelConfig } from "../contracts/index.ts";
import { createProvider } from "./providers/index.ts";
import type { ModelProvider } from "./providers/types.ts";

export class ConfigModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigModelError";
  }
}

/** Resolves model aliases to `ModelConfig`s and caches one `ModelProvider` per distinct
 * provider name declared in `config.provider` — the same two closely-related lookups
 * `AgentRuntime` used to do inline against its own `config`/`providers` fields. */
export class ModelRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(private readonly config: DhConfig) {}

  resolveModel(name: string): ModelConfig {
    const model = this.config.models.find((m) => m.name === name);
    if (!model) {
      throw new ConfigModelError(
        `unknown model "${name}"; known models: ${this.config.models.map((m) => m.name).join(", ")}`,
      );
    }
    return model;
  }

  providerFor(model: ModelConfig): ModelProvider {
    let provider = this.providers.get(model.provider);
    if (!provider) {
      const providerConfig = this.config.provider.find((p) => p.name === model.provider);
      if (!providerConfig) {
        throw new ConfigModelError(
          `model "${model.name}" references unknown provider "${model.provider}"`,
        );
      }
      provider = createProvider(providerConfig);
      this.providers.set(model.provider, provider);
    }
    return provider;
  }
}
