// ADR 0007. This is the dh.json wire truth — src/config/ owns loading/validation against
// these types; nothing else redeclares the shape locally.

export interface ModelConfig {
  /** Name tools/options refer to this model by. Never the provider-side id directly. */
  name: string;
  /** References a ProviderConfig.name. */
  provider: string;
  /** Provider-side model identifier. */
  model: string;
  /**
   * Optional per-model pricing, USD per million tokens (HANDOFF.md §9's "token and cost
   * display" requirement — round 6b). No public fixed price exists for local/Bedrock
   * models, so this must come from config, never a hardcoded table. When either is
   * unset, cost for that side of the split is treated as $0 rather than making the whole
   * event's `costUsd` undefined — but if *neither* is set, `costUsd` stays undefined
   * entirely (current behavior for unconfigured models is preserved, not silently
   * reported as $0.00).
   */
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
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
  /**
   * Overrides `loop.ts`'s `DEFAULT_MAX_TURNS` (100) safety valve for every agent loop this
   * runtime runs (root and every sub-agent alike) — round 6c. HANDOFF.md §1/§4 describes
   * unattended dark-factory runs lasting hours with hundreds of tool calls; the default cap
   * exists to bound a pathological loop, not to constrain a legitimate long-running task.
   */
  maxTurns?: number;
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
