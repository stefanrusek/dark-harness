import { describe, expect, test } from "bun:test";
import { AnthropicProvider } from "./anthropic.ts";
import { BedrockProvider } from "./bedrock.ts";
import { createProvider } from "./index.ts";

describe("createProvider", () => {
  test("builds an AnthropicProvider for type 'anthropic'", () => {
    const provider = createProvider({ name: "anthropic", type: "anthropic" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  test("builds a BedrockProvider for type 'bedrock'", () => {
    const provider = createProvider({ name: "bedrock", type: "bedrock" });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });
});
