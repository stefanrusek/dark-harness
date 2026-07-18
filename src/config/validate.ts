// Validates a parsed (and already $(VAR)-interpolated) config object against the DhConfig
// wire shape (src/contracts/config.type.ts). Throws ConfigError with an actionable message on
// any violation — this is the harness-error path per ADR 0006, never a raw crash.

import type {
  DhConfig,
  McpServerConfig,
  ModelConfig,
  ProviderConfig,
  ProviderType,
  SecurityTlsConfig,
  ThinkingConfig,
  WebConfig,
  WebFetchConfig,
  WebSearchConfig,
} from "../contracts/index.ts";
import { ConfigError } from "./errors.ts";

const PROVIDER_TYPES: ProviderType[] = ["anthropic", "bedrock", "openai-compatible"];

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
  "openai-compatible": new Set(["baseURL", "apiKey"]),
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
  "web",
  "compaction",
]);

// DH-0010 Part B: opt-in context-window compaction — see src/contracts/config.type.ts's
// `CompactionConfig` doc comment.
const KNOWN_COMPACTION_KEYS = new Set(["enabled", "thresholdPercent"]);

// DH-0074: `web.fetch`/`web.search` opt-in blocks — see src/contracts/config.type.ts's WebConfig
// doc comment for the "presence registers the tool, absence means it doesn't exist" semantics.
const KNOWN_WEB_FETCH_KEYS = new Set([
  "timeoutMs",
  "maxResponseBytes",
  "maxOutputChars",
  "allowPrivateNetwork",
  "allowedHosts",
  "extractionModel",
]);
const KNOWN_WEB_SEARCH_KEYS = new Set(["provider", "apiKey", "timeoutMs", "maxResults"]);
const WEB_SEARCH_PROVIDERS = new Set(["brave"]);

// DH-0045: opt-in extended thinking — see src/contracts/config.type.ts's `ThinkingConfig` doc
// comment for the adaptive/enabled distinction.
const KNOWN_THINKING_KEYS = new Set(["type", "budgetTokens", "display"]);
const THINKING_TYPES = new Set(["adaptive", "enabled"]);
const THINKING_DISPLAYS = new Set(["summarized", "omitted"]);

const KNOWN_LIMITS_KEYS = new Set(["completedRetention"]);

// DH-0037: `.dh-logs/` rotation/prune policy — see src/contracts/config.type.ts's
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
  const thinking =
    raw.thinking !== undefined
      ? validateThinking(raw.thinking, `models[${index}].thinking`)
      : undefined;
  // DH-0010 Part A: opt-in per-model prompt caching.
  const cache = raw.cache;
  if (cache !== undefined && typeof cache !== "boolean") {
    throw new ConfigError(`models[${index}].cache must be a boolean when present`);
  }
  const cacheReadPricePerMToken = validateOptionalPrice(
    raw.cacheReadPricePerMToken,
    `models[${index}].cacheReadPricePerMToken`,
  );
  const cacheWritePricePerMToken = validateOptionalPrice(
    raw.cacheWritePricePerMToken,
    `models[${index}].cacheWritePricePerMToken`,
  );
  // DH-0010 Part B: this model's context window, in tokens — required only when
  // `compaction.enabled` is true (cross-checked once every model is parsed, see
  // validateConfig()'s call to validateCompactionRequiresContextWindow below).
  const contextWindow = validatePositiveNumber(
    raw.contextWindow,
    `models[${index}].contextWindow`,
    true,
  );
  return {
    name,
    provider,
    model,
    ...(inputPricePerMToken !== undefined ? { inputPricePerMToken } : {}),
    ...(outputPricePerMToken !== undefined ? { outputPricePerMToken } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(cache !== undefined ? { cache } : {}),
    ...(cacheReadPricePerMToken !== undefined ? { cacheReadPricePerMToken } : {}),
    ...(cacheWritePricePerMToken !== undefined ? { cacheWritePricePerMToken } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  };
}

/** DH-0045: validates the optional `models[].thinking` block. See
 * src/contracts/config.type.ts's `ThinkingConfig` doc comment for the adaptive/enabled
 * distinction — `type: "enabled"` requires `budgetTokens` (integer, >= 1024); `type:
 * "adaptive"` forbids it. `display`, when present, must be "summarized" or "omitted". */
function validateThinking(raw: unknown, path: string): ThinkingConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`${path} must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_THINKING_KEYS.has(key)) {
      throw new ConfigError(
        `${path} has unknown key "${key}"; known keys: ${[...KNOWN_THINKING_KEYS].join(", ")}`,
      );
    }
  }
  const type = raw.type;
  if (typeof type !== "string" || !THINKING_TYPES.has(type)) {
    throw new ConfigError(
      `${path}.type must be one of ${[...THINKING_TYPES].join(", ")}, got ${JSON.stringify(type)}`,
    );
  }
  let display: "summarized" | "omitted" | undefined;
  if (raw.display !== undefined) {
    if (typeof raw.display !== "string" || !THINKING_DISPLAYS.has(raw.display)) {
      throw new ConfigError(
        `${path}.display must be one of ${[...THINKING_DISPLAYS].join(", ")}, got ${JSON.stringify(raw.display)}`,
      );
    }
    display = raw.display as "summarized" | "omitted";
  }
  if (type === "enabled") {
    if (
      typeof raw.budgetTokens !== "number" ||
      !Number.isInteger(raw.budgetTokens) ||
      raw.budgetTokens < 1024
    ) {
      throw new ConfigError(
        `${path}.budgetTokens must be an integer >= 1024 when type is "enabled"`,
      );
    }
    return {
      type: "enabled",
      budgetTokens: raw.budgetTokens,
      ...(display !== undefined ? { display } : {}),
    };
  }
  // type === "adaptive"
  if (raw.budgetTokens !== undefined) {
    throw new ConfigError(`${path}.budgetTokens must be absent when type is "adaptive"`);
  }
  return {
    type: "adaptive",
    ...(display !== undefined ? { display } : {}),
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

/** DH-0074: validates the optional `web.fetch` block. Every field is optional (defaults are
 * applied by the tool itself at execute time, not here) except that `allowedHosts`, when
 * present, must be an array of non-empty strings. */
function validateWebFetch(raw: unknown): WebFetchConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("web.fetch must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_WEB_FETCH_KEYS.has(key)) {
      throw new ConfigError(
        `web.fetch has unknown key "${key}"; known keys: ${[...KNOWN_WEB_FETCH_KEYS].join(", ")}`,
      );
    }
  }
  const timeoutMs = validatePositiveNumber(raw.timeoutMs, "web.fetch.timeoutMs", true);
  const maxResponseBytes = validatePositiveNumber(
    raw.maxResponseBytes,
    "web.fetch.maxResponseBytes",
    true,
  );
  const maxOutputChars = validatePositiveNumber(
    raw.maxOutputChars,
    "web.fetch.maxOutputChars",
    true,
  );
  const allowPrivateNetwork = raw.allowPrivateNetwork;
  if (allowPrivateNetwork !== undefined && typeof allowPrivateNetwork !== "boolean") {
    throw new ConfigError("web.fetch.allowPrivateNetwork must be a boolean when present");
  }
  let allowedHosts: string[] | undefined;
  if (raw.allowedHosts !== undefined) {
    if (
      !Array.isArray(raw.allowedHosts) ||
      raw.allowedHosts.some((h) => typeof h !== "string" || h.length === 0)
    ) {
      throw new ConfigError("web.fetch.allowedHosts must be an array of non-empty strings");
    }
    allowedHosts = raw.allowedHosts as string[];
  }
  const extractionModel = raw.extractionModel;
  if (extractionModel !== undefined && typeof extractionModel !== "string") {
    throw new ConfigError("web.fetch.extractionModel must be a string when present");
  }
  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
    ...(maxOutputChars !== undefined ? { maxOutputChars } : {}),
    ...(allowPrivateNetwork !== undefined ? { allowPrivateNetwork } : {}),
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
    ...(extractionModel !== undefined ? { extractionModel } : {}),
  };
}

/** DH-0074: validates the optional `web.search` block. Unlike `web.fetch`, `provider` and
 * `apiKey` are required — a `web.search` block that's missing either is a config-load-time
 * error, not a silently-absent tool (see WebSearchConfig's doc comment). */
function validateWebSearch(raw: unknown): WebSearchConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("web.search must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_WEB_SEARCH_KEYS.has(key)) {
      throw new ConfigError(
        `web.search has unknown key "${key}"; known keys: ${[...KNOWN_WEB_SEARCH_KEYS].join(", ")}`,
      );
    }
  }
  const provider = raw.provider;
  if (typeof provider !== "string" || !WEB_SEARCH_PROVIDERS.has(provider)) {
    throw new ConfigError(
      `web.search.provider must be one of ${[...WEB_SEARCH_PROVIDERS].join(", ")}, got ${JSON.stringify(provider)}`,
    );
  }
  const apiKey = requireString(raw.apiKey, "web.search.apiKey");
  const timeoutMs = validatePositiveNumber(raw.timeoutMs, "web.search.timeoutMs", true);
  const maxResults = validatePositiveNumber(raw.maxResults, "web.search.maxResults", true);
  if (maxResults !== undefined && maxResults > 20) {
    throw new ConfigError("web.search.maxResults must not exceed 20");
  }
  return {
    provider: provider as "brave",
    apiKey,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxResults !== undefined ? { maxResults } : {}),
  };
}

/** DH-0074: validates the optional top-level `web` block. Absence of the whole block, or of
 * either sub-key, means that tool does not exist at all — see WebConfig's doc comment. */
function validateWeb(raw: unknown): WebConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("web must be an object");
  }
  const knownWebKeys = new Set(["fetch", "search"]);
  for (const key of Object.keys(raw)) {
    if (!knownWebKeys.has(key)) {
      throw new ConfigError(`web has unknown key "${key}"; known keys: fetch, search`);
    }
  }
  const fetchConfig = raw.fetch !== undefined ? validateWebFetch(raw.fetch) : undefined;
  const searchConfig = raw.search !== undefined ? validateWebSearch(raw.search) : undefined;
  if (fetchConfig === undefined && searchConfig === undefined) {
    return {};
  }
  return {
    ...(fetchConfig !== undefined ? { fetch: fetchConfig } : {}),
    ...(searchConfig !== undefined ? { search: searchConfig } : {}),
  };
}

// Exported for DH-0091: src/agent/mcp/project-config.ts reuses this exact validation path for
// a project's `.mcp.json` `mcpServers` key, so a `.mcp.json` entry is held to the same shape/
// validation as dh.json's own `mcpServers` field rather than a second, invented schema.
export function validateMcpServers(raw: unknown): Record<string, McpServerConfig> | undefined {
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

/** DH-0010 Part B: validates the optional top-level `compaction` block. `enabled` is
 * required when the block is present (boolean); `thresholdPercent`, if present, must be an
 * integer 1-99 (default 80 applied at read time, not here — see loop.ts). The cross-check
 * that every configured model has `contextWindow` when `enabled: true` happens separately in
 * `validateConfig` below, once every model has been parsed (this function only validates the
 * block's own shape). */
function validateCompaction(raw: unknown): DhConfig["compaction"] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError("compaction must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_COMPACTION_KEYS.has(key)) {
      throw new ConfigError(
        `compaction has unknown key "${key}"; known keys: ${[...KNOWN_COMPACTION_KEYS].join(", ")}`,
      );
    }
  }
  if (typeof raw.enabled !== "boolean") {
    throw new ConfigError("compaction.enabled must be a boolean");
  }
  let thresholdPercent: number | undefined;
  if (raw.thresholdPercent !== undefined) {
    if (
      typeof raw.thresholdPercent !== "number" ||
      !Number.isInteger(raw.thresholdPercent) ||
      raw.thresholdPercent < 1 ||
      raw.thresholdPercent > 99
    ) {
      throw new ConfigError("compaction.thresholdPercent must be an integer between 1 and 99");
    }
    thresholdPercent = raw.thresholdPercent;
  }
  return {
    enabled: raw.enabled,
    ...(thresholdPercent !== undefined ? { thresholdPercent } : {}),
  };
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
    // DH-0022: opt-in bind address, same null-means-unset normalization as token/tls above.
    let hostname: string | undefined;
    if (raw.security.hostname !== undefined && raw.security.hostname !== null) {
      if (typeof raw.security.hostname !== "string") {
        throw new ConfigError("security.hostname must be a string or null");
      }
      hostname = raw.security.hostname;
    }
    security = {
      ...(token !== undefined ? { token } : {}),
      ...(tls !== undefined ? { tls } : {}),
      ...(hostname !== undefined ? { hostname } : {}),
    };
  }

  const limits = validateLimits(raw.limits);
  const logRetention = validateLogRetention(raw.logRetention);
  const web = validateWeb(raw.web);
  const compaction = validateCompaction(raw.compaction);

  // DH-0010 Part B: `compaction.enabled: true` requires every configured model to declare
  // `contextWindow` — fail fast at config load (same spirit as the defaultModel referential
  // check above), not at hour three of an unattended run.
  if (compaction?.enabled) {
    for (const m of models) {
      if (m.contextWindow === undefined) {
        throw new ConfigError(
          `compaction.enabled is true but models[].contextWindow is missing for model "${m.name}"; every configured model must declare contextWindow when compaction is enabled`,
        );
      }
    }
  }

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
    ...(web !== undefined ? { web } : {}),
    ...(compaction !== undefined ? { compaction } : {}),
  };
  return config;
}
