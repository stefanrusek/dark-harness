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
});
