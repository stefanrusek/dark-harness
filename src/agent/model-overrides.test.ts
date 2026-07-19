import { describe, expect, test } from "bun:test";
import type { DhConfig, ModelConfig } from "../contracts/index.ts";
import {
  buildPricing,
  cacheOverride,
  compactionOverride,
  contextWindowOverride,
  pricingOverride,
  thinkingOverride,
} from "./model-overrides.ts";

function baseModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    name: "test-model",
    provider: "test-provider",
    model: "test-model-id",
    ...overrides,
  } as ModelConfig;
}

describe("buildPricing", () => {
  test("returns undefined when neither input nor output price is configured", () => {
    expect(buildPricing(baseModel())).toBeUndefined();
  });

  test("includes only the configured price fields", () => {
    expect(buildPricing(baseModel({ inputPricePerMToken: 1 }))).toEqual({
      inputPricePerMToken: 1,
    });
    expect(buildPricing(baseModel({ outputPricePerMToken: 2 }))).toEqual({
      outputPricePerMToken: 2,
    });
  });

  test("includes cache pricing when configured", () => {
    expect(
      buildPricing(
        baseModel({
          inputPricePerMToken: 1,
          outputPricePerMToken: 2,
          cacheReadPricePerMToken: 0.5,
          cacheWritePricePerMToken: 3,
        }),
      ),
    ).toEqual({
      inputPricePerMToken: 1,
      outputPricePerMToken: 2,
      cacheReadPricePerMToken: 0.5,
      cacheWritePricePerMToken: 3,
    });
  });
});

describe("pricingOverride", () => {
  test("empty object when no pricing configured", () => {
    expect(pricingOverride(baseModel())).toEqual({});
  });

  test("wraps buildPricing() result under `pricing` when configured", () => {
    expect(pricingOverride(baseModel({ inputPricePerMToken: 1 }))).toEqual({
      pricing: { inputPricePerMToken: 1 },
    });
  });
});

describe("thinkingOverride", () => {
  test("empty object when not configured", () => {
    expect(thinkingOverride(baseModel())).toEqual({});
  });

  test("passes through when configured", () => {
    const thinking: NonNullable<ModelConfig["thinking"]> = { type: "adaptive" };
    expect(thinkingOverride(baseModel({ thinking }))).toEqual({ thinking });
  });
});

describe("cacheOverride", () => {
  test("empty object when not configured", () => {
    expect(cacheOverride(baseModel())).toEqual({});
  });

  test("passes through when configured", () => {
    expect(cacheOverride(baseModel({ cache: true }))).toEqual({ cache: true });
  });
});

describe("contextWindowOverride", () => {
  test("empty object when not configured", () => {
    expect(contextWindowOverride(baseModel())).toEqual({});
  });

  test("passes through when configured", () => {
    expect(contextWindowOverride(baseModel({ contextWindow: 128000 }))).toEqual({
      contextWindow: 128000,
    });
  });
});

describe("compactionOverride", () => {
  function baseConfig(overrides: Partial<DhConfig> = {}): DhConfig {
    return {
      models: [],
      provider: [],
      options: {},
      ...overrides,
    } as unknown as DhConfig;
  }

  test("empty object when not configured", () => {
    expect(compactionOverride(baseConfig())).toEqual({});
  });

  test("passes through when configured", () => {
    const compaction = { enabled: true, thresholdPercent: 80 };
    expect(compactionOverride(baseConfig({ compaction }))).toEqual({ compaction });
  });
});
