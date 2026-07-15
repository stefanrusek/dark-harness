// Validates a parsed (and already $(VAR)-interpolated) config object against the DhConfig
// wire shape (src/contracts/config.ts). Throws ConfigError with an actionable message on
// any violation — this is the harness-error path per ADR 0006, never a raw crash.

import type {
  DhConfig,
  McpServerConfig,
  ModelConfig,
  ProviderConfig,
  ProviderType,
  SecurityTlsConfig,
} from "../contracts/index.ts";
import { ConfigError } from "./errors.ts";

const PROVIDER_TYPES: ProviderType[] = ["anthropic", "bedrock"];

/** ADR 0007: unknown top-level keys are rejected to catch config typos early. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "options",
  "models",
  "provider",
  "skillPaths",
  "mcpServers",
  "systemPrompt",
  "security",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`${path} must be a non-empty string`);
  }
  return value;
}

function validateProvider(raw: unknown, index: number): ProviderConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`provider[${index}] must be an object`);
  }
  const name = requireString(raw.name, `provider[${index}].name`);
  const type = raw.type;
  if (typeof type !== "string" || !PROVIDER_TYPES.includes(type as ProviderType)) {
    throw new ConfigError(
      `provider[${index}].type must be one of ${PROVIDER_TYPES.join(", ")}, got ${JSON.stringify(type)}`,
    );
  }
  const config: ProviderConfig = { ...raw, name, type: type as ProviderType };
  return config;
}

function validateModel(raw: unknown, index: number, providerNames: Set<string>): ModelConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`models[${index}] must be an object`);
  }
  const name = requireString(raw.name, `models[${index}].name`);
  const provider = requireString(raw.provider, `models[${index}].provider`);
  const model = requireString(raw.model, `models[${index}].model`);
  if (!providerNames.has(provider)) {
    throw new ConfigError(
      `models[${index}] ("${name}") references unknown provider "${provider}"; known providers: ${[...providerNames].join(", ") || "(none)"}`,
    );
  }
  const inputPricePerMToken = validateOptionalPrice(
    raw.inputPricePerMToken,
    `models[${index}].inputPricePerMToken`,
  );
  const outputPricePerMToken = validateOptionalPrice(
    raw.outputPricePerMToken,
    `models[${index}].outputPricePerMToken`,
  );
  return {
    name,
    provider,
    model,
    ...(inputPricePerMToken !== undefined ? { inputPricePerMToken } : {}),
    ...(outputPricePerMToken !== undefined ? { outputPricePerMToken } : {}),
  };
}

function validateOptionalPrice(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new ConfigError(`${path} must be a non-negative number when present`);
  }
  return value;
}

function validateMcpServers(raw: unknown): Record<string, McpServerConfig> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("mcpServers must be an object");
  }
  for (const [serverName, serverConfig] of Object.entries(raw)) {
    if (!isRecord(serverConfig)) {
      throw new ConfigError(`mcpServers["${serverName}"] must be an object`);
    }
    const hasStdio = typeof serverConfig.command === "string";
    const hasHttp = typeof serverConfig.url === "string";
    if (!hasStdio && !hasHttp) {
      throw new ConfigError(
        `mcpServers["${serverName}"] must specify either "command" (stdio) or "url" (HTTP)`,
      );
    }
  }
  return raw as Record<string, McpServerConfig>;
}

export function validateConfig(raw: unknown): DhConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("config root must be a JSON object");
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(
        `unknown config key "${key}"; known keys: ${[...KNOWN_TOP_LEVEL_KEYS].join(", ")}`,
      );
    }
  }

  if (!isRecord(raw.options)) {
    throw new ConfigError('config.options must be an object with at least "defaultModel"');
  }
  const defaultModel = requireString(raw.options.defaultModel, "options.defaultModel");
  const runInBackgroundDefault = raw.options.runInBackgroundDefault;
  if (runInBackgroundDefault !== undefined && typeof runInBackgroundDefault !== "boolean") {
    throw new ConfigError("options.runInBackgroundDefault must be a boolean when present");
  }
  const maxTurns = raw.options.maxTurns;
  if (
    maxTurns !== undefined &&
    (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns <= 0)
  ) {
    throw new ConfigError("options.maxTurns must be a positive integer when present");
  }

  if (!Array.isArray(raw.provider)) {
    throw new ConfigError("config.provider must be an array");
  }
  const providers = raw.provider.map((p, i) => validateProvider(p, i));
  const providerNames = new Set(providers.map((p) => p.name));

  if (!Array.isArray(raw.models) || raw.models.length === 0) {
    throw new ConfigError("config.models must be a non-empty array");
  }
  const models = raw.models.map((m, i) => validateModel(m, i, providerNames));

  if (!models.some((m) => m.name === defaultModel)) {
    throw new ConfigError(
      `options.defaultModel "${defaultModel}" does not match any models[].name (${models.map((m) => m.name).join(", ")})`,
    );
  }

  let skillPaths: string[] | undefined;
  if (raw.skillPaths !== undefined) {
    if (!Array.isArray(raw.skillPaths) || raw.skillPaths.some((p) => typeof p !== "string")) {
      throw new ConfigError("skillPaths must be an array of strings");
    }
    skillPaths = raw.skillPaths as string[];
  }

  const mcpServers = validateMcpServers(raw.mcpServers);

  let systemPrompt: string | null | undefined;
  if (raw.systemPrompt !== undefined) {
    if (raw.systemPrompt !== null && typeof raw.systemPrompt !== "string") {
      throw new ConfigError("systemPrompt must be a string path or null");
    }
    systemPrompt = raw.systemPrompt;
  }

  let security: DhConfig["security"];
  if (raw.security !== undefined) {
    if (!isRecord(raw.security)) {
      throw new ConfigError("security must be an object");
    }
    // ADR 0007's sample config uses `null` to mean "unset" for token/tls; normalize both to
    // omitted keys since the wire type (SecurityConfig) declares them as optional, not nullable.
    let token: string | undefined;
    if (raw.security.token !== undefined && raw.security.token !== null) {
      if (typeof raw.security.token !== "string") {
        throw new ConfigError("security.token must be a string or null");
      }
      token = raw.security.token;
    }
    let tls: SecurityTlsConfig | undefined;
    if (raw.security.tls !== undefined && raw.security.tls !== null) {
      if (!isRecord(raw.security.tls)) {
        throw new ConfigError("security.tls must be an object or null");
      }
      const cert = requireString(raw.security.tls.cert, "security.tls.cert");
      const key = requireString(raw.security.tls.key, "security.tls.key");
      tls = { cert, key };
    }
    security = { ...(token !== undefined ? { token } : {}), ...(tls !== undefined ? { tls } : {}) };
  }

  const config: DhConfig = {
    options: {
      defaultModel,
      ...(runInBackgroundDefault !== undefined ? { runInBackgroundDefault } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
    },
    models,
    provider: providers,
    ...(skillPaths !== undefined ? { skillPaths } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(security !== undefined ? { security } : {}),
  };
  return config;
}
