import { describe, expect, test } from "bun:test";
import { ConfigError } from "./errors.ts";
import { validateConfig } from "./validate.ts";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    options: { defaultModel: "sonnet" },
    models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
    provider: [{ name: "anthropic", type: "anthropic" }],
    ...overrides,
  };
}

describe("validateConfig — happy paths", () => {
  test("accepts the minimal valid config", () => {
    const config = validateConfig(baseConfig());
    expect(config.options.defaultModel).toBe("sonnet");
    expect(config.models).toHaveLength(1);
    expect(config.provider).toHaveLength(1);
  });

  test("accepts the full ADR 0007 sample config", () => {
    const config = validateConfig({
      options: { defaultModel: "sonnet" },
      models: [
        { name: "sonnet", provider: "anthropic", model: "sonnet-5" },
        { name: "gemma4", provider: "bedrock", model: "gemma4" },
      ],
      provider: [
        { name: "anthropic", type: "anthropic" },
        { name: "bedrock", type: "bedrock" },
        { name: "local", type: "anthropic" },
      ],
      skillPaths: ["./skills"],
      mcpServers: {},
      systemPrompt: null,
      security: { token: null, tls: null },
    });
    expect(config.models).toHaveLength(2);
    expect(config.skillPaths).toEqual(["./skills"]);
    expect(config.systemPrompt).toBeNull();
    // null token/tls normalize to omitted keys (SecurityConfig has no null variant).
    expect(config.security).toEqual({});
  });

  test("accepts runInBackgroundDefault", () => {
    const config = validateConfig(
      baseConfig({ options: { defaultModel: "sonnet", runInBackgroundDefault: false } }),
    );
    expect(config.options.runInBackgroundDefault).toBe(false);
  });

  test("accepts mcpServers with stdio and http entries", () => {
    const config = validateConfig(
      baseConfig({
        mcpServers: {
          local: { command: "mcp-server", args: ["--foo"] },
          remote: { url: "https://example.com/mcp" },
        },
      }),
    );
    expect(config.mcpServers).toBeDefined();
  });

  test("accepts a security block with a real token and tls", () => {
    const config = validateConfig(
      baseConfig({ security: { token: "abc123", tls: { cert: "/c.pem", key: "/k.pem" } } }),
    );
    expect(config.security).toEqual({ token: "abc123", tls: { cert: "/c.pem", key: "/k.pem" } });
  });

  // Round 6c (docs/handoffs/core.md): options.maxTurns wasn't threadable from dh.json at all.
  test("accepts options.maxTurns", () => {
    const config = validateConfig(
      baseConfig({ options: { defaultModel: "sonnet", maxTurns: 500 } }),
    );
    expect(config.options.maxTurns).toBe(500);
  });

  test("options.maxTurns is omitted (not defaulted here) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.options.maxTurns).toBeUndefined();
  });

  // Round 6b (docs/handoffs/core.md): per-model pricing, since costUsd was fully wired but
  // nothing computed a real value.
  test("accepts per-model inputPricePerMToken/outputPricePerMToken", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          {
            name: "sonnet",
            provider: "anthropic",
            model: "sonnet-5",
            inputPricePerMToken: 3,
            outputPricePerMToken: 15,
          },
        ],
      }),
    );
    expect(config.models[0]?.inputPricePerMToken).toBe(3);
    expect(config.models[0]?.outputPricePerMToken).toBe(15);
  });

  test("model pricing fields are omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.models[0]?.inputPricePerMToken).toBeUndefined();
    expect(config.models[0]?.outputPricePerMToken).toBeUndefined();
  });

  test("provider entries may carry extra type-specific fields", () => {
    const config = validateConfig(
      baseConfig({
        provider: [{ name: "anthropic", type: "anthropic", baseURL: "http://localhost:1234" }],
      }),
    );
    expect(config.provider[0]?.baseURL).toBe("http://localhost:1234");
  });
});

describe("validateConfig — rejections", () => {
  test("rejects a non-object root", () => {
    expect(() => validateConfig("not an object")).toThrow(ConfigError);
    expect(() => validateConfig(null)).toThrow(ConfigError);
    expect(() => validateConfig([])).toThrow(ConfigError);
  });

  test("rejects unknown top-level keys", () => {
    expect(() => validateConfig(baseConfig({ bogus: true }))).toThrow(/unknown config key "bogus"/);
  });

  test("rejects missing options", () => {
    const { options, ...rest } = baseConfig();
    expect(() => validateConfig(rest)).toThrow(/options/);
  });

  test("rejects missing options.defaultModel", () => {
    expect(() => validateConfig(baseConfig({ options: {} }))).toThrow(/defaultModel/);
  });

  test("rejects non-boolean runInBackgroundDefault", () => {
    expect(() =>
      validateConfig(
        baseConfig({ options: { defaultModel: "sonnet", runInBackgroundDefault: "yes" } }),
      ),
    ).toThrow(/runInBackgroundDefault/);
  });

  test("rejects non-array provider", () => {
    expect(() => validateConfig(baseConfig({ provider: {} }))).toThrow(/provider must be an array/);
  });

  test("rejects a non-object provider entry", () => {
    expect(() => validateConfig(baseConfig({ provider: ["nope"] }))).toThrow(
      /provider\[0\] must be an object/,
    );
  });

  test("rejects a provider missing name", () => {
    expect(() => validateConfig(baseConfig({ provider: [{ type: "anthropic" }] }))).toThrow(
      /provider\[0\]\.name/,
    );
  });

  test("rejects a provider with an invalid type", () => {
    expect(() => validateConfig(baseConfig({ provider: [{ name: "x", type: "openai" }] }))).toThrow(
      /provider\[0\]\.type/,
    );
  });

  test("rejects an empty models array", () => {
    expect(() => validateConfig(baseConfig({ models: [] }))).toThrow(
      /models must be a non-empty array/,
    );
  });

  test("rejects a non-array models value", () => {
    expect(() => validateConfig(baseConfig({ models: {} }))).toThrow(
      /models must be a non-empty array/,
    );
  });

  test("rejects a non-object model entry", () => {
    expect(() => validateConfig(baseConfig({ models: ["nope"] }))).toThrow(
      /models\[0\] must be an object/,
    );
  });

  test("rejects a model missing name", () => {
    expect(() =>
      validateConfig(baseConfig({ models: [{ provider: "anthropic", model: "sonnet-5" }] })),
    ).toThrow(/models\[0\]\.name/);
  });

  test("rejects a model missing provider field", () => {
    expect(() =>
      validateConfig(baseConfig({ models: [{ name: "sonnet", model: "sonnet-5" }] })),
    ).toThrow(/models\[0\]\.provider/);
  });

  test("rejects a model missing model field", () => {
    expect(() =>
      validateConfig(baseConfig({ models: [{ name: "sonnet", provider: "anthropic" }] })),
    ).toThrow(/models\[0\]\.model/);
  });

  test("rejects a model referencing an unknown provider", () => {
    expect(() =>
      validateConfig(
        baseConfig({ models: [{ name: "sonnet", provider: "ghost", model: "sonnet-5" }] }),
      ),
    ).toThrow(/unknown provider "ghost"/);
  });

  test("rejects a defaultModel that matches no model name", () => {
    expect(() => validateConfig(baseConfig({ options: { defaultModel: "ghost" } }))).toThrow(
      /defaultModel "ghost" does not match/,
    );
  });

  test("rejects a non-array skillPaths", () => {
    expect(() => validateConfig(baseConfig({ skillPaths: "not-an-array" }))).toThrow(/skillPaths/);
  });

  test("rejects skillPaths with non-string entries", () => {
    expect(() => validateConfig(baseConfig({ skillPaths: [1, 2] }))).toThrow(/skillPaths/);
  });

  test("rejects a non-object mcpServers", () => {
    expect(() => validateConfig(baseConfig({ mcpServers: "nope" }))).toThrow(
      /mcpServers must be an object/,
    );
  });

  test("rejects a non-object mcpServers entry", () => {
    expect(() => validateConfig(baseConfig({ mcpServers: { foo: "nope" } }))).toThrow(
      /mcpServers\["foo"\] must be an object/,
    );
  });

  test("rejects an mcpServers entry with neither command nor url", () => {
    expect(() => validateConfig(baseConfig({ mcpServers: { foo: {} } }))).toThrow(
      /mcpServers\["foo"\] must specify either/,
    );
  });

  test("rejects a non-string/non-null systemPrompt", () => {
    expect(() => validateConfig(baseConfig({ systemPrompt: 42 }))).toThrow(/systemPrompt/);
  });

  test("rejects a non-object security block", () => {
    expect(() => validateConfig(baseConfig({ security: "nope" }))).toThrow(
      /security must be an object/,
    );
  });

  test("rejects a non-string/non-null security.token", () => {
    expect(() => validateConfig(baseConfig({ security: { token: 42 } }))).toThrow(/security.token/);
  });

  test("rejects a non-object/non-null security.tls", () => {
    expect(() => validateConfig(baseConfig({ security: { tls: "nope" } }))).toThrow(
      /security.tls must be/,
    );
  });

  test("rejects security.tls missing cert", () => {
    expect(() => validateConfig(baseConfig({ security: { tls: { key: "/k.pem" } } }))).toThrow(
      /security.tls.cert/,
    );
  });

  test("rejects security.tls missing key", () => {
    expect(() => validateConfig(baseConfig({ security: { tls: { cert: "/c.pem" } } }))).toThrow(
      /security.tls.key/,
    );
  });

  test("rejects a non-integer options.maxTurns", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxTurns: 1.5 } })),
    ).toThrow(/options.maxTurns must be a positive integer/);
  });

  test("rejects a non-positive options.maxTurns", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxTurns: 0 } })),
    ).toThrow(/options.maxTurns must be a positive integer/);
  });

  test("DH-0015: rejects a typo'd key inside a provider entry", () => {
    expect(() =>
      validateConfig(
        baseConfig({ provider: [{ name: "anthropic", type: "anthropic", apiKye: "x" }] }),
      ),
    ).toThrow(/provider\[0\].*unknown key "apiKye"/);
  });

  test("DH-0015: rejects a bedrock-only key (region) on an anthropic-type provider", () => {
    expect(() =>
      validateConfig(
        baseConfig({ provider: [{ name: "anthropic", type: "anthropic", region: "us-west-2" }] }),
      ),
    ).toThrow(/unknown key "region"/);
  });

  test("DH-0015: accepts region on a bedrock-type provider", () => {
    const config = validateConfig(
      baseConfig({
        models: [{ name: "sonnet", provider: "bedrock", model: "sonnet-5" }],
        provider: [{ name: "bedrock", type: "bedrock", region: "us-west-2" }],
      }),
    );
    expect(config.provider[0]?.region).toBe("us-west-2");
  });

  test("DH-0009: accepts a well-formed provider retry config", () => {
    const config = validateConfig(
      baseConfig({
        provider: [
          {
            name: "anthropic",
            type: "anthropic",
            retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 5000 },
          },
        ],
      }),
    );
    expect(config.provider[0]?.retry).toEqual({
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 5000,
    });
  });

  test("DH-0009: rejects a non-object provider retry config", () => {
    expect(() =>
      validateConfig(
        baseConfig({ provider: [{ name: "anthropic", type: "anthropic", retry: "fast" }] }),
      ),
    ).toThrow(/provider\[0\].retry must be an object/);
  });

  test("DH-0009: rejects a typo'd key inside a provider retry config", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          provider: [{ name: "anthropic", type: "anthropic", retry: { maxAttepts: 5 } }],
        }),
      ),
    ).toThrow(/provider\[0\].retry has unknown key "maxAttepts"/);
  });

  test("DH-0009: rejects a non-positive provider retry field", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          provider: [{ name: "anthropic", type: "anthropic", retry: { maxAttempts: 0 } }],
        }),
      ),
    ).toThrow(/provider\[0\].retry.maxAttempts must be a positive number/);
  });

  test("DH-0015: rejects a typo'd key inside an mcpServers entry", () => {
    expect(() =>
      validateConfig(baseConfig({ mcpServers: { foo: { command: "x", enviroment: {} } } })),
    ).toThrow(/mcpServers\["foo"\] has unknown key "enviroment"/);
  });

  test("DH-0013: accepts session budget options", () => {
    const config = validateConfig(
      baseConfig({
        options: {
          defaultModel: "sonnet",
          maxCostUsd: 5.5,
          maxTotalTokens: 100000,
          maxWallClockMs: 3600000,
          maxConcurrentAgents: 10,
          maxAgentDepth: 3,
        },
      }),
    );
    expect(config.options.maxCostUsd).toBe(5.5);
    expect(config.options.maxTotalTokens).toBe(100000);
    expect(config.options.maxWallClockMs).toBe(3600000);
    expect(config.options.maxConcurrentAgents).toBe(10);
    expect(config.options.maxAgentDepth).toBe(3);
  });

  test("DH-0013: session budget options are omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.options.maxCostUsd).toBeUndefined();
    expect(config.options.maxTotalTokens).toBeUndefined();
    expect(config.options.maxWallClockMs).toBeUndefined();
    expect(config.options.maxConcurrentAgents).toBeUndefined();
    expect(config.options.maxAgentDepth).toBeUndefined();
  });

  test("DH-0013: rejects a non-positive/non-numeric maxCostUsd (non-integer allowed)", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxCostUsd: 0 } })),
    ).toThrow(/options.maxCostUsd must be a positive number/);
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxCostUsd: "free" } })),
    ).toThrow(/options.maxCostUsd must be a positive number/);
    // Unlike the integer-only budgets below, a fractional dollar amount is valid.
    const config = validateConfig(
      baseConfig({ options: { defaultModel: "sonnet", maxCostUsd: 1.25 } }),
    );
    expect(config.options.maxCostUsd).toBe(1.25);
  });

  test("DH-0013: rejects a non-positive-integer maxTotalTokens", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxTotalTokens: -1 } })),
    ).toThrow(/options.maxTotalTokens must be a positive integer/);
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxTotalTokens: 1.5 } })),
    ).toThrow(/options.maxTotalTokens must be a positive integer/);
  });

  test("DH-0013: rejects a non-positive-integer maxWallClockMs", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxWallClockMs: 0 } })),
    ).toThrow(/options.maxWallClockMs must be a positive integer/);
  });

  test("DH-0013: rejects a non-positive-integer maxConcurrentAgents", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxConcurrentAgents: 0 } })),
    ).toThrow(/options.maxConcurrentAgents must be a positive integer/);
  });

  test("DH-0013: rejects a non-positive-integer maxAgentDepth", () => {
    expect(() =>
      validateConfig(baseConfig({ options: { defaultModel: "sonnet", maxAgentDepth: -2 } })),
    ).toThrow(/options.maxAgentDepth must be a positive integer/);
  });

  test("rejects a negative models[].inputPricePerMToken", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", inputPricePerMToken: -1 },
          ],
        }),
      ),
    ).toThrow(/models\[0\].inputPricePerMToken must be a non-negative number/);
  });

  test("rejects a non-numeric models[].outputPricePerMToken", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              outputPricePerMToken: "free",
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].outputPricePerMToken must be a non-negative number/);
  });

  // DH-0012 (tracking/DH-0012-unbounded-memory-growth-across-harness.md): the `limits`
  // config block controlling fixed-count eviction caps.
  test("DH-0012: accepts limits.completedRetention", () => {
    const config = validateConfig(baseConfig({ limits: { completedRetention: 100 } }));
    expect(config.limits?.completedRetention).toBe(100);
  });

  test("DH-0012: limits is omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.limits).toBeUndefined();
  });

  test("DH-0012: rejects a non-positive-integer limits.completedRetention", () => {
    expect(() => validateConfig(baseConfig({ limits: { completedRetention: 0 } }))).toThrow(
      /limits.completedRetention must be a positive integer/,
    );
    expect(() => validateConfig(baseConfig({ limits: { completedRetention: 1.5 } }))).toThrow(
      /limits.completedRetention must be a positive integer/,
    );
  });

  test("DH-0012: rejects a non-object limits", () => {
    expect(() => validateConfig(baseConfig({ limits: "fifty" }))).toThrow(
      /limits must be an object/,
    );
  });

  test("DH-0012: rejects an unknown key inside limits", () => {
    expect(() =>
      validateConfig(baseConfig({ limits: { completedRetention: 10, maxThings: 5 } })),
    ).toThrow(/limits has unknown key "maxThings"/);
  });

  test("DH-0012: rejects an unknown top-level config key mentioning limits in the error", () => {
    expect(() => validateConfig(baseConfig({ limitz: {} }))).toThrow(/unknown config key "limitz"/);
  });
});
