// ADR 0007. This is the dh.json wire truth — src/config/ owns loading/validation against
// these types; nothing else redeclares the shape locally.

export interface ModelConfig {
  /** Name tools/options refer to this model by. Never the provider-side id directly. */
  name: string;
  /** References a ProviderConfig.name. */
  provider: string;
  /** Provider-side model identifier. */
  model: string;
}

export type ProviderType = "anthropic" | "bedrock";

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  /** Anthropic-type only: point at any Anthropic-compatible endpoint (e.g. a "local" provider). */
  baseURL?: string;
  apiKey?: string;
  region?: string;
  [key: string]: unknown;
}

export interface SecurityTlsConfig {
  cert: string;
  key: string;
}

export interface SecurityConfig {
  /** Bearer token required on every request when set. Never logged. */
  token?: string;
  tls?: SecurityTlsConfig;
}

export interface McpServerConfig {
  /** stdio server */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** HTTP server */
  url?: string;
  headers?: Record<string, string>;
}

export interface DhOptions {
  defaultModel: string;
  /** Overrides the default `run_in_background: true` for every async-capable tool. */
  runInBackgroundDefault?: boolean;
}

export interface DhConfig {
  options: DhOptions;
  models: ModelConfig[];
  provider: ProviderConfig[];
  /** Directories scanned for skill folders (each containing a SKILL.md). */
  skillPaths?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  /** Path overriding the built-in system prompt. */
  systemPrompt?: string | null;
  security?: SecurityConfig;
}
