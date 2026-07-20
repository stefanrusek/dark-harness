// DH-0173: extracted from runtime.ts — pure `AgentLoopParams` spreadable-override helpers.
// No behavior change; these were free functions in runtime.ts, moved verbatim so runtime.ts
// itself shrinks and this small, easily-unit-testable slice can be tested in isolation.

import type { DhConfig, ModelConfig } from "../contracts/index.ts";

/** Builds loop.ts's `AgentLoopParams.pricing` from a model's optional config prices — round
 * 6b. Returns undefined when neither price is configured (so `costUsd` stays undefined,
 * per computeCostUsd()'s own doc comment in loop.ts), otherwise an object with only the
 * configured keys present (exactOptionalPropertyTypes forbids passing `undefined` through
 * explicitly). */
export function buildPricing(model: ModelConfig):
  | {
      inputPricePerMToken?: number;
      outputPricePerMToken?: number;
      cacheReadPricePerMToken?: number;
      cacheWritePricePerMToken?: number;
    }
  | undefined {
  if (model.inputPricePerMToken === undefined && model.outputPricePerMToken === undefined) {
    return undefined;
  }
  return {
    ...(model.inputPricePerMToken !== undefined
      ? { inputPricePerMToken: model.inputPricePerMToken }
      : {}),
    ...(model.outputPricePerMToken !== undefined
      ? { outputPricePerMToken: model.outputPricePerMToken }
      : {}),
    // DH-0010 Part A: threaded straight through — computeCostUsd (loop.ts) applies the
    // 0.1x/1.25x default multipliers itself when these are unset.
    ...(model.cacheReadPricePerMToken !== undefined
      ? { cacheReadPricePerMToken: model.cacheReadPricePerMToken }
      : {}),
    ...(model.cacheWritePricePerMToken !== undefined
      ? { cacheWritePricePerMToken: model.cacheWritePricePerMToken }
      : {}),
  };
}

/** Spreadable helper: `{ pricing: ... }` when configured, `{}` otherwise — kept as its own
 * function (rather than inlining the ternary at each call site) because
 * `exactOptionalPropertyTypes` rejects a ternary whose branches are `{ pricing: X }` and
 * `{}` when `X` itself is `T | undefined` (it can't narrow the conditional's own type), so
 * this needs the `undefined` check and the object literal built in one place. */
export function pricingOverride(
  model: ModelConfig,
):
  | { pricing: { inputPricePerMToken?: number; outputPricePerMToken?: number } }
  | Record<string, never> {
  const pricing = buildPricing(model);
  if (pricing === undefined) return {};
  return { pricing };
}

/** DH-0045: `{ thinking: ... }` when configured, `{}` otherwise — same spreadable-helper
 * pattern as `pricingOverride` above. */
export function thinkingOverride(
  model: ModelConfig,
): { thinking: NonNullable<ModelConfig["thinking"]> } | Record<string, never> {
  if (model.thinking === undefined) return {};
  return { thinking: model.thinking };
}

/** DH-0010 Part A: `{ cache: ... }` when configured, `{}` otherwise — same spreadable-helper
 * pattern as `pricingOverride`/`thinkingOverride` above. */
export function cacheOverride(model: ModelConfig): { cache: boolean } | Record<string, never> {
  if (model.cache === undefined) return {};
  return { cache: model.cache };
}

/** DH-0010 Part B: `{ contextWindow: ... }` when configured, `{}` otherwise — same
 * spreadable-helper pattern as `pricingOverride`/`thinkingOverride`/`cacheOverride` above. */
export function contextWindowOverride(
  model: ModelConfig,
): { contextWindow: number } | Record<string, never> {
  if (model.contextWindow === undefined) return {};
  return { contextWindow: model.contextWindow };
}

/** DH-0010 Part B: `{ compaction: ... }` when the top-level config block is present,
 * `{}` otherwise — session-wide (not per-model), so this reads `DhConfig.compaction`
 * directly rather than a `ModelConfig` field. */
export function compactionOverride(
  config: DhConfig,
): { compaction: { enabled: boolean; thresholdPercent?: number } } | Record<string, never> {
  if (config.compaction === undefined) return {};
  return { compaction: config.compaction };
}
