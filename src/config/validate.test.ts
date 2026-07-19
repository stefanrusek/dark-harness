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

  // DH-0045: opt-in extended thinking — see src/contracts/config.type.ts's ThinkingConfig doc
  // comment for the adaptive/enabled distinction.
  test("accepts models[].thinking with type adaptive (no budgetTokens)", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          {
            name: "sonnet",
            provider: "anthropic",
            model: "sonnet-5",
            thinking: { type: "adaptive" },
          },
        ],
      }),
    );
    expect(config.models[0]?.thinking).toEqual({ type: "adaptive" });
  });

  test("accepts models[].thinking with type adaptive and a display value", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          {
            name: "sonnet",
            provider: "anthropic",
            model: "sonnet-5",
            thinking: { type: "adaptive", display: "omitted" },
          },
        ],
      }),
    );
    expect(config.models[0]?.thinking).toEqual({ type: "adaptive", display: "omitted" });
  });

  test("accepts models[].thinking with type enabled and a valid budgetTokens", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          {
            name: "sonnet",
            provider: "anthropic",
            model: "sonnet-5",
            thinking: { type: "enabled", budgetTokens: 2048, display: "summarized" },
          },
        ],
      }),
    );
    expect(config.models[0]?.thinking).toEqual({
      type: "enabled",
      budgetTokens: 2048,
      display: "summarized",
    });
  });

  test("models[].thinking is omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.models[0]?.thinking).toBeUndefined();
  });

  test("rejects models[].thinking.type that is neither adaptive nor enabled", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "bogus" },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.type must be one of adaptive, enabled/);
  });

  test("rejects models[].thinking with type enabled and no budgetTokens", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "enabled" },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.budgetTokens must be an integer >= 1024/);
  });

  test("rejects models[].thinking with type enabled and budgetTokens below 1024", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "enabled", budgetTokens: 1023 },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.budgetTokens must be an integer >= 1024/);
  });

  test("rejects models[].thinking with type enabled and a non-integer budgetTokens", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "enabled", budgetTokens: 2048.5 },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.budgetTokens must be an integer >= 1024/);
  });

  test("rejects models[].thinking with type adaptive and a present budgetTokens", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "adaptive", budgetTokens: 2048 },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.budgetTokens must be absent when type is "adaptive"/);
  });

  test("rejects models[].thinking.display that is neither summarized nor omitted", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "adaptive", display: "verbose" },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking.display must be one of summarized, omitted/);
  });

  test("rejects models[].thinking with an unknown key", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              thinking: { type: "adaptive", bogusKey: true },
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking has unknown key "bogusKey"/);
  });

  test("rejects models[].thinking that is not an object", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", thinking: "adaptive" },
          ],
        }),
      ),
    ).toThrow(/models\[0\].thinking must be an object/);
  });

  test("no provider-type restriction: thinking is valid on a bedrock model too", () => {
    const config = validateConfig({
      options: { defaultModel: "gemma4" },
      models: [
        { name: "gemma4", provider: "bedrock", model: "gemma4", thinking: { type: "adaptive" } },
      ],
      provider: [{ name: "bedrock", type: "bedrock" }],
    });
    expect(config.models[0]?.thinking).toEqual({ type: "adaptive" });
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

  test("DH-0022: rejects a non-string/non-null security.hostname", () => {
    expect(() => validateConfig(baseConfig({ security: { hostname: 42 } }))).toThrow(
      /security.hostname/,
    );
  });

  test("DH-0022: accepts and passes through a valid security.hostname", () => {
    const config = validateConfig(baseConfig({ security: { hostname: "127.0.0.1" } }));
    expect(config.security?.hostname).toBe("127.0.0.1");
  });

  test("DH-0022: security.hostname omitted (unset) means no hostname field in the result — default bind behavior unchanged", () => {
    const config = validateConfig(baseConfig({ security: { token: "t" } }));
    expect(config.security?.hostname).toBeUndefined();
  });

  test("DH-0022: security.hostname: null normalizes to omitted, same as token/tls", () => {
    const config = validateConfig(baseConfig({ security: { hostname: null } }));
    expect(config.security?.hostname).toBeUndefined();
  });

  test("DH-0168: rejects a non-number security.webPort", () => {
    expect(() => validateConfig(baseConfig({ security: { webPort: "8080" } }))).toThrow(
      /security.webPort must be a positive integer or null/,
    );
  });

  test("DH-0168: rejects a non-integer security.webPort", () => {
    expect(() => validateConfig(baseConfig({ security: { webPort: 8080.5 } }))).toThrow(
      /security.webPort must be a positive integer or null/,
    );
  });

  test("DH-0168: rejects a non-positive security.webPort", () => {
    expect(() => validateConfig(baseConfig({ security: { webPort: 0 } }))).toThrow(
      /security.webPort must be a positive integer or null/,
    );
  });

  test("DH-0168: accepts and passes through a valid security.webPort", () => {
    const config = validateConfig(baseConfig({ security: { webPort: 8080 } }));
    expect(config.security?.webPort).toBe(8080);
  });

  test("DH-0168: security.webPort omitted (unset) means no webPort field in the result — default random-port behavior unchanged", () => {
    const config = validateConfig(baseConfig({ security: { token: "t" } }));
    expect(config.security?.webPort).toBeUndefined();
  });

  test("DH-0168: security.webPort: null normalizes to omitted, same as hostname/token/tls", () => {
    const config = validateConfig(baseConfig({ security: { webPort: null } }));
    expect(config.security?.webPort).toBeUndefined();
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

  test("DH-0107: accepts baseURL and apiKey on an openai-compatible-type provider", () => {
    const config = validateConfig(
      baseConfig({
        options: { defaultModel: "gemma4" },
        models: [{ name: "gemma4", provider: "mantle", model: "google.gemma-4-31b" }],
        provider: [
          {
            name: "mantle",
            type: "openai-compatible",
            baseURL: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
            apiKey: "key",
          },
        ],
      }),
    );
    expect(config.provider[0]?.baseURL).toBe("https://bedrock-mantle.us-east-1.api.aws/openai/v1");
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

  // DH-0037 (tracking/DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md): the
  // `logRetention` config block controlling `.dh-logs/` rotation/prune.
  test("DH-0037: accepts logRetention.maxAgeMs and maxTotalBytes", () => {
    const config = validateConfig(
      baseConfig({ logRetention: { maxAgeMs: 86_400_000, maxTotalBytes: 1_000_000 } }),
    );
    expect(config.logRetention).toEqual({ maxAgeMs: 86_400_000, maxTotalBytes: 1_000_000 });
  });

  test("DH-0037: logRetention is omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.logRetention).toBeUndefined();
  });

  test("DH-0037: an empty logRetention object is accepted as-is (no pruning)", () => {
    const config = validateConfig(baseConfig({ logRetention: {} }));
    expect(config.logRetention).toEqual({});
  });

  test("DH-0037: rejects a non-positive-integer logRetention.maxAgeMs", () => {
    expect(() => validateConfig(baseConfig({ logRetention: { maxAgeMs: 0 } }))).toThrow(
      /logRetention.maxAgeMs must be a positive integer/,
    );
    expect(() => validateConfig(baseConfig({ logRetention: { maxAgeMs: 1.5 } }))).toThrow(
      /logRetention.maxAgeMs must be a positive integer/,
    );
  });

  test("DH-0037: rejects a non-positive-integer logRetention.maxTotalBytes", () => {
    expect(() => validateConfig(baseConfig({ logRetention: { maxTotalBytes: -1 } }))).toThrow(
      /logRetention.maxTotalBytes must be a positive integer/,
    );
  });

  test("DH-0037: rejects a non-object logRetention", () => {
    expect(() => validateConfig(baseConfig({ logRetention: "always" }))).toThrow(
      /logRetention must be an object/,
    );
  });

  test("DH-0037: rejects an unknown key inside logRetention", () => {
    expect(() => validateConfig(baseConfig({ logRetention: { maxAgeMs: 1000, foo: 1 } }))).toThrow(
      /logRetention has unknown key "foo"/,
    );
  });

  test("DH-0012: rejects an unknown top-level config key mentioning limits in the error", () => {
    expect(() => validateConfig(baseConfig({ limitz: {} }))).toThrow(/unknown config key "limitz"/);
  });
});

// DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16): the opt-in `web`
// block. Absence of the block, or of either sub-key, means that tool isn't registered at all
// — see composeTools() in src/agent/tools/index.ts.
describe("validateConfig — web (DH-0074)", () => {
  test("web is omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.web).toBeUndefined();
  });

  test("an empty web object is accepted as-is (both tools remain absent)", () => {
    const config = validateConfig(baseConfig({ web: {} }));
    expect(config.web).toEqual({});
  });

  test("rejects a non-object web", () => {
    expect(() => validateConfig(baseConfig({ web: "on" }))).toThrow(/web must be an object/);
  });

  test("rejects an unknown key at the web top level", () => {
    expect(() => validateConfig(baseConfig({ web: { fetc: {} } }))).toThrow(
      /web has unknown key "fetc"/,
    );
  });

  test("web.fetch: an empty object is a valid minimal opt-in (all fields default)", () => {
    const config = validateConfig(baseConfig({ web: { fetch: {} } }));
    expect(config.web?.fetch).toEqual({});
  });

  test("web.fetch: accepts every documented field", () => {
    const config = validateConfig(
      baseConfig({
        web: {
          fetch: {
            timeoutMs: 5000,
            maxResponseBytes: 1024,
            maxOutputChars: 500,
            allowPrivateNetwork: true,
            allowedHosts: ["docs.example.com"],
            extractionModel: "haiku",
          },
        },
      }),
    );
    expect(config.web?.fetch).toEqual({
      timeoutMs: 5000,
      maxResponseBytes: 1024,
      maxOutputChars: 500,
      allowPrivateNetwork: true,
      allowedHosts: ["docs.example.com"],
      extractionModel: "haiku",
    });
  });

  test("web.fetch: rejects a non-object value", () => {
    expect(() => validateConfig(baseConfig({ web: { fetch: "yes" } }))).toThrow(
      /web.fetch must be an object/,
    );
  });

  test("web.fetch: rejects an unknown key", () => {
    expect(() => validateConfig(baseConfig({ web: { fetch: { bogus: 1 } } }))).toThrow(
      /web.fetch has unknown key "bogus"/,
    );
  });

  test("web.fetch: rejects a non-positive-integer timeoutMs/maxResponseBytes/maxOutputChars", () => {
    expect(() => validateConfig(baseConfig({ web: { fetch: { timeoutMs: -1 } } }))).toThrow(
      /web.fetch.timeoutMs must be a positive integer/,
    );
    expect(() => validateConfig(baseConfig({ web: { fetch: { maxResponseBytes: 0 } } }))).toThrow(
      /web.fetch.maxResponseBytes must be a positive integer/,
    );
    expect(() => validateConfig(baseConfig({ web: { fetch: { maxOutputChars: 1.5 } } }))).toThrow(
      /web.fetch.maxOutputChars must be a positive integer/,
    );
  });

  test("web.fetch: rejects a non-boolean allowPrivateNetwork", () => {
    expect(() =>
      validateConfig(baseConfig({ web: { fetch: { allowPrivateNetwork: "yes" } } })),
    ).toThrow(/web.fetch.allowPrivateNetwork must be a boolean/);
  });

  test("web.fetch: rejects a non-array-of-strings allowedHosts", () => {
    expect(() =>
      validateConfig(baseConfig({ web: { fetch: { allowedHosts: "example.com" } } })),
    ).toThrow(/web.fetch.allowedHosts must be an array of non-empty strings/);
    expect(() => validateConfig(baseConfig({ web: { fetch: { allowedHosts: [""] } } }))).toThrow(
      /web.fetch.allowedHosts must be an array of non-empty strings/,
    );
  });

  test("web.fetch: rejects a non-string extractionModel", () => {
    expect(() => validateConfig(baseConfig({ web: { fetch: { extractionModel: 42 } } }))).toThrow(
      /web.fetch.extractionModel must be a string/,
    );
  });

  test("web.search: requires provider and apiKey", () => {
    expect(() => validateConfig(baseConfig({ web: { search: {} } }))).toThrow(
      /web.search.provider must be one of brave/,
    );
    expect(() => validateConfig(baseConfig({ web: { search: { provider: "brave" } } }))).toThrow(
      /web.search.apiKey must be a non-empty string/,
    );
  });

  test("web.search: accepts a valid minimal config, applying $(VAR)-free literal apiKey", () => {
    const config = validateConfig(
      baseConfig({ web: { search: { provider: "brave", apiKey: "key-123" } } }),
    );
    expect(config.web?.search).toEqual({ provider: "brave", apiKey: "key-123" });
  });

  test("web.search: accepts optional timeoutMs/maxResults", () => {
    const config = validateConfig(
      baseConfig({
        web: { search: { provider: "brave", apiKey: "key", timeoutMs: 5000, maxResults: 15 } },
      }),
    );
    expect(config.web?.search).toEqual({
      provider: "brave",
      apiKey: "key",
      timeoutMs: 5000,
      maxResults: 15,
    });
  });

  test("web.search: rejects an unsupported provider", () => {
    expect(() =>
      validateConfig(baseConfig({ web: { search: { provider: "google", apiKey: "key" } } })),
    ).toThrow(/web.search.provider must be one of brave/);
  });

  test("web.search: rejects an unknown key", () => {
    expect(() =>
      validateConfig(
        baseConfig({ web: { search: { provider: "brave", apiKey: "key", bogus: 1 } } }),
      ),
    ).toThrow(/web.search has unknown key "bogus"/);
  });

  test("web.search: rejects a non-object value", () => {
    expect(() => validateConfig(baseConfig({ web: { search: "yes" } }))).toThrow(
      /web.search must be an object/,
    );
  });

  test("web.search: rejects maxResults above the hard cap of 20", () => {
    expect(() =>
      validateConfig(
        baseConfig({ web: { search: { provider: "brave", apiKey: "key", maxResults: 21 } } }),
      ),
    ).toThrow(/web.search.maxResults must not exceed 20/);
  });

  test("both web.fetch and web.search can be configured together, independently", () => {
    const config = validateConfig(
      baseConfig({
        web: {
          fetch: { timeoutMs: 1000 },
          search: { provider: "brave", apiKey: "key" },
        },
      }),
    );
    expect(config.web?.fetch).toEqual({ timeoutMs: 1000 });
    expect(config.web?.search).toEqual({ provider: "brave", apiKey: "key" });
  });
});

describe("DH-0010 Part A: models[].cache/cacheReadPricePerMToken/cacheWritePricePerMToken", () => {
  test("accepts models[].cache: true", () => {
    const config = validateConfig(
      baseConfig({
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5", cache: true }],
      }),
    );
    expect(config.models[0]?.cache).toBe(true);
  });

  test("models[].cache is omitted (not defaulted) when unset", () => {
    const config = validateConfig(baseConfig());
    expect(config.models[0]?.cache).toBeUndefined();
  });

  test("rejects a non-boolean models[].cache", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5", cache: "yes" }],
        }),
      ),
    ).toThrow(/models\[0\].cache must be a boolean/);
  });

  test("accepts models[].cacheReadPricePerMToken/cacheWritePricePerMToken", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          {
            name: "sonnet",
            provider: "anthropic",
            model: "sonnet-5",
            cacheReadPricePerMToken: 0.3,
            cacheWritePricePerMToken: 3.75,
          },
        ],
      }),
    );
    expect(config.models[0]?.cacheReadPricePerMToken).toBe(0.3);
    expect(config.models[0]?.cacheWritePricePerMToken).toBe(3.75);
  });

  test("rejects a negative cacheReadPricePerMToken", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            {
              name: "sonnet",
              provider: "anthropic",
              model: "sonnet-5",
              cacheReadPricePerMToken: -1,
            },
          ],
        }),
      ),
    ).toThrow(/models\[0\].cacheReadPricePerMToken must be a non-negative number/);
  });
});

describe("DH-0010 Part B: compaction config + models[].contextWindow", () => {
  test("accepts models[].contextWindow", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
        ],
      }),
    );
    expect(config.models[0]?.contextWindow).toBe(200000);
  });

  test("compaction is omitted (disabled) when absent — default behavior unchanged", () => {
    const config = validateConfig(baseConfig());
    expect(config.compaction).toBeUndefined();
  });

  test("accepts compaction: { enabled: true } when every model has contextWindow", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
        ],
        compaction: { enabled: true },
      }),
    );
    expect(config.compaction).toEqual({ enabled: true });
  });

  test("accepts compaction.thresholdPercent between 1 and 99", () => {
    const config = validateConfig(
      baseConfig({
        models: [
          { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
        ],
        compaction: { enabled: true, thresholdPercent: 90 },
      }),
    );
    expect(config.compaction).toEqual({ enabled: true, thresholdPercent: 90 });
  });

  test("rejects compaction.thresholdPercent outside 1-99", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
          ],
          compaction: { enabled: true, thresholdPercent: 100 },
        }),
      ),
    ).toThrow(/compaction.thresholdPercent must be an integer between 1 and 99/);
  });

  test("rejects compaction without enabled", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
          ],
          compaction: { thresholdPercent: 50 },
        }),
      ),
    ).toThrow(/compaction.enabled must be a boolean/);
  });

  test("rejects a non-object compaction value", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
          ],
          compaction: "enabled",
        }),
      ),
    ).toThrow(/compaction must be an object/);
  });

  test("rejects an unknown compaction key", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
          ],
          compaction: { enabled: true, bogus: true },
        }),
      ),
    ).toThrow(/compaction has unknown key "bogus"/);
  });

  test("given compaction.enabled: true and a model missing contextWindow, throws naming the model and the field", () => {
    expect(() =>
      validateConfig(
        baseConfig({
          models: [
            { name: "sonnet", provider: "anthropic", model: "sonnet-5", contextWindow: 200000 },
            { name: "gemma4", provider: "anthropic", model: "gemma4" },
          ],
          compaction: { enabled: true },
        }),
      ),
    ).toThrow(
      /compaction.enabled is true but models\[\].contextWindow is missing for model "gemma4"/,
    );
  });

  test("given compaction.enabled: false, a model missing contextWindow is fine", () => {
    const config = validateConfig(baseConfig({ compaction: { enabled: false } }));
    expect(config.compaction).toEqual({ enabled: false });
  });
});
