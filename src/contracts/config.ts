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

/**
 * DH-0009 (tracking/DH-0009-provider-retry-backoff-and-error-taxonomy.md): per-provider
 * retry/backoff tuning. Every field is optional with a sane built-in default (see
 * src/agent/providers/retry.ts) — this exists so an operator can widen/narrow retry behavior
 * per provider (e.g. a flaky local endpoint vs. a production Anthropic/Bedrock account)
 * without needing a code change.
 */
export interface ProviderRetryConfig {
  /** Total attempts, including the first (non-retry) one. Default 3. */
  maxAttempts?: number;
  /** Base delay before the first retry, doubled each subsequent attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Upper bound on the (pre-jitter) computed delay. Default 8000ms. */
  maxDelayMs?: number;
}

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  /** Anthropic-type only: point at any Anthropic-compatible endpoint (e.g. a "local" provider). */
  baseURL?: string;
  apiKey?: string;
  region?: string;
  /** DH-0009: retry/backoff tuning for transient failures against this provider. */
  retry?: ProviderRetryConfig;
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
  /** DH-0002: overrides both the connect timeout (default 10s) and the per-call tool
   * invocation timeout (default 60s) for this server. Optional; omitted means "use the
   * McpManager/connection defaults." */
  timeoutMs?: number;
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
  /**
   * DH-0013 (tracking/DH-0013-no-cost-turn-time-or-fanout-budgets.md): `maxTurns` above was
   * the *only* safety valve on a running session — no wall-clock timeout, no cumulative
   * cost/token budget, and no cap on sub-agent fan-out, so a runaway/looping agent could burn
   * arbitrary compute/spend with nothing to stop it. These are all session-wide (root plus
   * every sub-agent combined), enforced by AgentRuntime, and all optional — omitted means no
   * cap of that kind, matching pre-DH-0013 behavior exactly.
   */
  /** Cumulative USD across every agent in the session (requires per-model pricing configured
   * — see ModelConfig — otherwise cost is never computed and this cap can never trigger). */
  maxCostUsd?: number;
  /** Cumulative input+output tokens across every agent in the session. */
  maxTotalTokens?: number;
  /** Wall-clock duration of the whole session, independent of turn count. */
  maxWallClockMs?: number;
  /** Maximum number of agents (root + sub-agents) live (running/waiting) at once. */
  maxConcurrentAgents?: number;
  /** Maximum sub-agent nesting depth; the root is depth 0, a sub-agent it spawns is depth 1,
   * a sub-agent *that* spawns is depth 2, and so on. */
  maxAgentDepth?: number;
}

/**
 * DH-0012 (tracking/DH-0012-unbounded-memory-growth-across-harness.md): caps on in-memory
 * structures that would otherwise grow unboundedly across a long/wide-fanout session.
 * Owner-decided policy: fixed-count cap, oldest-evicted-first, applied only to
 * terminal/completed entries — active entries are never evicted regardless of count. Each
 * domain (Core's TaskRegistry, Server's EventBuffer, TUI's/Web's agent maps) applies this
 * cap independently to its own structure(s).
 */
export interface LimitsConfig {
  /** Max number of terminal/completed entries retained per capped structure before the
   * oldest are evicted. Default 50 when omitted. */
  completedRetention?: number;
}

/**
 * DH-0037 (tracking/DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md): prunes
 * old `.dh-logs/<sessionId>/` directories so a long-lived host running many jobs (or one
 * very long/verbose session) doesn't accumulate disk usage indefinitely. Both caps are
 * optional and independent; omitting both — the default, and the value when `dh.json` has
 * no `logRetention` key at all — preserves today's behavior of never pruning anything,
 * matching this project's general pattern of new knobs defaulting off (see LimitsConfig's
 * own doc comment for the same call on its caps).
 */
export interface LogRetentionConfig {
  /** Delete a session directory outright once its most recently written file is older than
   * this many milliseconds. */
  maxAgeMs?: number;
  /** After age-pruning (if configured), if total `.dh-logs` size still exceeds this many
   * bytes, delete the oldest-by-last-write remaining session directories one at a time
   * until under the cap. The session directory currently being written by this process is
   * never pruned by either cap. */
  maxTotalBytes?: number;
}

/**
 * DH-0074 (tracking/DH-0074-no-webfetch-websearch-equivalent-tool-for-an-autonomous-coding-agent-to-look-up-docs-or-errors-online.md):
 * architect design (Fable, 2026-07-16). Presence of `web.fetch` registers the WebFetch tool,
 * presence of `web.search` registers the WebSearch tool — absence means the tool does not
 * exist at all, not registered-but-erroring. Both default off, consistent with the
 * air-gapped-by-default posture (ADR 0003, Constitution §4.3).
 */
export interface WebFetchConfig {
  /** Whole-request wall-clock timeout via `AbortSignal.timeout`. Default 30000. */
  timeoutMs?: number;
  /** Hard cap on bytes read from the response body — streamed and aborted past this limit
   * (Bun has no built-in response-size cap). Default 4 MiB (4194304). */
  maxResponseBytes?: number;
  /** Cap on the text returned to the model after HTML-to-text conversion, with an explicit
   * truncation notice (no silent truncation — Constitution §8). Default 50000. */
  maxOutputChars?: number;
  /** Default `false`. `true` disables the SSRF private-address check, for operators
   * deliberately pointing WebFetch at internal docs servers. */
  allowPrivateNetwork?: boolean;
  /** When set, only these hosts (exact or dot-suffix match, e.g. `example.com` matches
   * `docs.example.com`) are fetchable. Unset means any public host. */
  allowedHosts?: string[];
  /** A `ModelConfig.name` used to answer the tool call's `prompt` against fetched content in
   * one non-streaming provider call, instead of returning raw extracted content. Its token
   * usage feeds session accounting (DH-0013 budgets). */
  extractionModel?: string;
}

export type WebSearchProvider = "brave";

export interface WebSearchConfig {
  /** Discriminated string so a self-hosted backend (e.g. `"searxng"`) can be added later
   * without restructuring. v1 supports only `"brave"`. */
  provider: WebSearchProvider;
  /** Brave Search API key. `$(VAR)` interpolation applies. Joins DH-0020's redaction set —
   * never logged. */
  apiKey: string;
  /** Default 10000. */
  timeoutMs?: number;
  /** Default 10, hard cap 20. */
  maxResults?: number;
}

export interface WebConfig {
  fetch?: WebFetchConfig;
  search?: WebSearchConfig;
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
  /** DH-0012: caps on in-memory structures that would otherwise grow unboundedly. */
  limits?: LimitsConfig;
  /** DH-0037: `.dh-logs/` rotation/prune policy. Omitted means no pruning (today's
   * behavior, unchanged). */
  logRetention?: LogRetentionConfig;
  /** DH-0074: opt-in outbound web access (WebFetch/WebSearch). Omitted means neither tool is
   * registered — the harness stays fully air-gapped by default. */
  web?: WebConfig;
}
