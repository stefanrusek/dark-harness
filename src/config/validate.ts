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

// DH-0015 fix (tracking/DH-0015-config-validation-gaps.md): provider/mcpServers entries used
// to spread unknown keys straight through unchecked (`{ ...raw, name, type }`), unlike the
// strict top-level allowlist just below — a typo'd key inside one of these (e.g. `apiKye`
// instead of `apiKey`) was silently accepted, with the intended field silently `undefined`,
// defeating the file's own stated "catch config typos early" goal. Every provider entry
// accepts `name`/`type` plus `retry` (DH-0009's provider-level retry/backoff config); the
// remaining keys are type-specific.
const PROVIDER_COMMON_KEYS = new Set(["name", "type", "retry"]);
const PROVIDER_TYPE_KEYS: Record<ProviderType, Set<string>> = {
  anthropic: new Set(["baseURL", "apiKey"]),
  bedrock: new Set(["region"]),
};
const KNOWN_MCP_SERVER_KEYS = new Set(["command", "args", "env", "url", "headers"]);

/** ADR 0007: unknown top-level keys are rejected to catch config typos early. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "options",
  "models",
  "provider",
  "skillPaths",
  "mcpServers",
  "systemPrompt",
  "security",
  "limits",
  "logRetention",
]);

const KNOWN_LIMITS_KEYS = new Set(["completedRetention"]);

// DH-0037: `.dh-logs/` rotation/prune policy — see src/contracts/config.ts's
// `LogRetentionConfig` doc comment.
const KNOWN_LOG_RETENTION_KEYS = new Set(["maxAgeMs", "maxTotalBytes"]);

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
  const providerType = type as ProviderType;
  const allowedKeys = PROVIDER_TYPE_KEYS[providerType];
  for (const key of Object.keys(raw)) {
    if (!PROVIDER_COMMON_KEYS.has(key) && !allowedKeys.has(key)) {
      const known = [...PROVIDER_COMMON_KEYS, ...allowedKeys].join(", ");
      throw new ConfigError(
        `provider[${index}] ("${name}", type "${providerType}") has unknown key "${key}"; known keys for this type: ${known}`,
      );
    }
  }
  if (raw.retry !== undefined) {
    validateProviderRetry(raw.retry, `provider[${index}].retry`);
  }
  const config: ProviderConfig = { ...raw, name, type: providerType };
  return config;
}

/** DH-0009: validates the optional per-provider retry/backoff tuning object — every field is
 * optional, but a present field must be a positive number, not some other typo'd shape. */
function validateProviderRetry(raw: unknown, path: string): void {
  if (!isRecord(raw)) {
    throw new ConfigError(`${path} must be an object`);
  }
  const known = new Set(["maxAttempts", "baseDelayMs", "maxDelayMs"]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new ConfigError(
        `${path} has unknown key "${key}"; known keys: ${[...known].join(", ")}`,
      );
    }
  }
  for (const key of known) {
    const value = (raw as Record<string, unknown>)[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    ) {
      throw new ConfigError(`${path}.${key} must be a positive number when present`);
    }
  }
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

/** DH-0013: validates an optional positive number/integer budget field. */
function validatePositiveNumber(
  value: unknown,
  path: string,
  requireInteger: boolean,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (requireInteger && !Number.isInteger(value))
  ) {
    throw new ConfigError(
      `${path} must be a positive ${requireInteger ? "integer" : "number"} when present`,
    );
  }
  return value;
}

/** DH-0012: validates the optional `limits` block controlling fixed-count eviction caps
 * (e.g. Core's TaskRegistry, Server's EventBuffer, TUI's/Web's agent maps). */
function validateLimits(raw: unknown): DhConfig["limits"] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("limits must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_LIMITS_KEYS.has(key)) {
      throw new ConfigError(
        `limits has unknown key "${key}"; known keys: ${[...KNOWN_LIMITS_KEYS].join(", ")}`,
      );
    }
  }
  const completedRetention = validatePositiveNumber(
    raw.completedRetention,
    "limits.completedRetention",
    true,
  );
  return completedRetention !== undefined ? { completedRetention } : {};
}

/** DH-0037: validates the optional `logRetention` block controlling `.dh-logs/` rotation.
 * Both fields are optional positive numbers; omitting both (or the whole block) means no
 * pruning, matching `validateLimits`'s own default-off pattern above. */
function validateLogRetention(raw: unknown): DhConfig["logRetention"] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("logRetention must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_LOG_RETENTION_KEYS.has(key)) {
      throw new ConfigError(
        `logRetention has unknown key "${key}"; known keys: ${[...KNOWN_LOG_RETENTION_KEYS].join(", ")}`,
      );
    }
  }
  const maxAgeMs = validatePositiveNumber(raw.maxAgeMs, "logRetention.maxAgeMs", true);
  const maxTotalBytes = validatePositiveNumber(
    raw.maxTotalBytes,
    "logRetention.maxTotalBytes",
    true,
  );
  return {
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(maxTotalBytes !== undefined ? { maxTotalBytes } : {}),
  };
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
    for (const key of Object.keys(serverConfig)) {
      if (!KNOWN_MCP_SERVER_KEYS.has(key)) {
        throw new ConfigError(
          `mcpServers["${serverName}"] has unknown key "${key}"; known keys: ${[...KNOWN_MCP_SERVER_KEYS].join(", ")}`,
        );
      }
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

  // DH-0013: session-wide budget caps — all optional, all "positive number/integer when
  // present", following the same pattern as maxTurns above.
  const maxCostUsd = validatePositiveNumber(raw.options.maxCostUsd, "options.maxCostUsd", false);
  const maxTotalTokens = validatePositiveNumber(
    raw.options.maxTotalTokens,
    "options.maxTotalTokens",
    true,
  );
  const maxWallClockMs = validatePositiveNumber(
    raw.options.maxWallClockMs,
    "options.maxWallClockMs",
    true,
  );
  const maxConcurrentAgents = validatePositiveNumber(
    raw.options.maxConcurrentAgents,
    "options.maxConcurrentAgents",
    true,
  );
  const maxAgentDepth = validatePositiveNumber(
    raw.options.maxAgentDepth,
    "options.maxAgentDepth",
    true,
  );

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

  const limits = validateLimits(raw.limits);
  const logRetention = validateLogRetention(raw.logRetention);

  const config: DhConfig = {
    options: {
      defaultModel,
      ...(runInBackgroundDefault !== undefined ? { runInBackgroundDefault } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
      ...(maxWallClockMs !== undefined ? { maxWallClockMs } : {}),
      ...(maxConcurrentAgents !== undefined ? { maxConcurrentAgents } : {}),
      ...(maxAgentDepth !== undefined ? { maxAgentDepth } : {}),
    },
    models,
    provider: providers,
    ...(skillPaths !== undefined ? { skillPaths } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(security !== undefined ? { security } : {}),
    ...(limits !== undefined ? { limits } : {}),
    ...(logRetention !== undefined ? { logRetention } : {}),
  };
  return config;
}
