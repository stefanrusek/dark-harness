# Configuring `dh.json`

This is the full reference for `dh.json`: the complete option/field walkthrough, every
provider type set up in detail, and the air-gapped-deployment specifics. See
[README.md](../README.md) for the quick-start version and a concise field summary.

Full schema rationale: [`docs/adr/0007-dhjson-schema.md`](adr/0007-dhjson-schema.md). Wire
truth: [`src/contracts/config.ts`](../src/contracts/config.ts) — `src/prompt/readme-config-sync.test.ts`
fails the build if a field is added to `DhOptions`/`ModelConfig` without landing a mention in
README.md, so drift is caught automatically.

## The scaffolded config

This is exactly what `dh init` writes:

```json
{
  "options": { "defaultModel": "haiku-bedrock", "runInBackgroundDefault": true, "maxTurns": 100 },
  "models": [
    { "name": "fable-anthropic", "provider": "anthropic", "model": "claude-fable-5" },
    { "name": "fable-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-fable-5" },
    { "name": "opus-anthropic", "provider": "anthropic", "model": "claude-opus-4-8" },
    { "name": "opus-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-opus-4-8" },
    {
      "name": "sonnet-anthropic",
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "inputPricePerMToken": 3,
      "outputPricePerMToken": 15
    },
    { "name": "sonnet-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-sonnet-5" },
    { "name": "haiku-anthropic", "provider": "anthropic", "model": "claude-haiku-4-5" },
    {
      "name": "haiku-bedrock",
      "provider": "bedrock",
      "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    },
    { "name": "gemma4", "provider": "mantle-openai", "model": "google.gemma-4-31b" },
    {
      "name": "haiku-mantle",
      "provider": "mantle-anthropic",
      "model": "anthropic.claude-haiku-4-5"
    },
    { "name": "gpt-oss-20b", "provider": "bedrock", "model": "openai.gpt-oss-20b-1:0" },
    { "name": "gpt-oss-120b", "provider": "bedrock", "model": "openai.gpt-oss-120b-1:0" },
    {
      "name": "llama3-3-70b",
      "provider": "bedrock",
      "model": "us.meta.llama3-3-70b-instruct-v1:0"
    },
    {
      "name": "mistral-large-3",
      "provider": "bedrock",
      "model": "mistral.mistral-large-3-675b-instruct"
    }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" },
    { "name": "bedrock", "type": "bedrock", "region": "$(AWS_REGION)" },
    {
      "name": "mantle-anthropic",
      "type": "anthropic",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    {
      "name": "mantle-openai",
      "type": "openai-compatible",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    { "name": "local", "type": "anthropic", "baseURL": "$(LOCAL_AI_PROVIDER)" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
```

This is a **menu, not a recommendation to use all of it** — trim it down to the models you
actually plan to use before running `dh doctor`/`dh --check`, which probes every configured
model's credentials. The Bedrock model/inference-profile ids above were verified live against
the real Bedrock API (`ListFoundationModels`/`ListInferenceProfiles` plus a smoke-test
`Converse` call) for the **`us-east-1`** region specifically — Bedrock catalogs are
region-specific and change over time, so re-verify before relying on this list in another
region. The Claude tiers use cross-region `us.*` inference profile ids on Bedrock (the bare
on-demand model ids aren't invokable directly for those); `us.anthropic.claude-fable-5` also
requires your AWS org to be configured for 30-day (or longer) data retention — it returns a
validation error under the default zero/short retention configuration.

## `models[]`

Named entries mapping to a named `provider` plus a provider-side model id. Tools and options
refer to models by `name`, never by the provider-side id directly.

- **`name`**, **`provider`** (references a `provider[].name`), **`model`** (the provider-side
  model id) are required.
- **`inputPricePerMToken`** / **`outputPricePerMToken`** (USD per million tokens, optional)
  drive the token/cost display in the TUI and web UI — there's no built-in pricing table (no
  public fixed price exists for local/Bedrock models), so cost tracking for a model is opt-in
  via these fields. If only one of the pair is set, the other side of that model's cost is
  treated as `$0`; if neither is set, cost stays unreported (`undefined`) for that model
  rather than showing a misleading `$0.00`.
- **`thinking`** (optional) opts a model into extended thinking. `{ "type": "adaptive" }` is
  the form for Claude 4.6+ (Opus 4.7/4.8, Sonnet 5, Fable 5) — no `budgetTokens`. `{ "type":
  "enabled", "budgetTokens": 4096 }` is the legacy fixed-budget form for pre-4.6 models —
  `budgetTokens` required, integer, >= 1024. Both accept an optional `"display": "summarized"
  | "omitted"`. Omitted entirely (the default) means no `thinking` parameter is sent at all —
  `dh` does no capability gating, so requesting the wrong form for a given model surfaces as
  that provider's own 400 error.
- **`cache`** (optional, default `false`) opts this model into prompt caching — the Anthropic
  adapter marks `cache_control: { type: "ephemeral" }` breakpoints (system+tools, plus the two
  most recent message positions) and the Bedrock adapter marks equivalent `cachePoint` blocks
  at the same three positions. Per-model (not per-provider) because caching support varies by
  model/endpoint. Optional **`cacheReadPricePerMToken`** / **`cacheWritePricePerMToken`** price
  cache tokens for cost display; when unset but `inputPricePerMToken` is set they default to
  0.1x/1.25x of the input price (the published multiplier on both Anthropic and Bedrock).
- **`contextWindow`** (optional, tokens) declares this model's context limit — required for
  every configured model when the top-level `compaction.enabled` option (below) is `true`.

## `provider[]` — every provider type

`type` is one of `"anthropic"`, `"bedrock"`, or `"openai-compatible"`. All three are
first-class — pick whichever matches the endpoint you're calling. Each provider also accepts
an optional `retry` block (`maxAttempts`, `baseDelayMs`, `maxDelayMs`) tuning transient-failure
retry/backoff; all three have built-in defaults (3 attempts, 500ms base delay, 8000ms max
delay).

### `type: "anthropic"` — Anthropic API and Anthropic-compatible endpoints

Uses the Anthropic SDK's Messages API directly. Two shapes:

```json
{ "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" }
```

```json
{ "name": "local", "type": "anthropic", "baseURL": "$(LOCAL_AI_PROVIDER)" }
```

- **`apiKey`** — your Anthropic API key. `$(VAR)` interpolation applies; never hardcode it in
  a committed `dh.json` (see [Keeping secrets out of `dh.json`](#keeping-secrets-out-of-dhjson---env-file)
  below).
- **`baseURL`** (optional) — points this provider at any Anthropic-compatible endpoint instead
  of `api.anthropic.com`, e.g. LM Studio or another local inference server speaking the same
  Messages API shape. This is how you run fully offline: a `baseURL`-pointed local provider
  needs no external network access at all. It's also how Bedrock Mantle's Anthropic-shaped
  route is configured (see below) — `type: "anthropic"` isn't exclusively "the real Anthropic
  API," it's "anything that speaks the Anthropic Messages wire shape."
- **Errors** surface as `ProviderError` with a classified kind (auth, rate-limit, overloaded,
  connection failure, etc.) — the same taxonomy every provider type uses.

### `type: "bedrock"` — AWS Bedrock (bedrock-runtime)

```json
{
  "provider": [
    { "name": "bedrock", "type": "bedrock", "region": "us-west-2" }
  ],
  "models": [
    { "name": "sonnet", "provider": "bedrock", "model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" }
  ]
}
```

- **`region`** — the AWS region the Bedrock endpoint is called in (e.g. `us-west-2`). If
  omitted, the AWS SDK falls back to its own region resolution (an `AWS_REGION`/
  `AWS_DEFAULT_REGION` env var, or a configured region in `~/.aws/config`).
- **Credentials** — `dh` does no custom credential handling for Bedrock; it relies entirely on
  the AWS SDK's standard credential chain, the same one any AWS CLI tool uses. In order:
  environment variables (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`),
  the shared credentials/config files (`~/.aws/credentials`, `~/.aws/config`, respecting
  `AWS_PROFILE`), and finally an instance/container/task role when running on EC2, ECS, or
  Lambda. There is no `dh.json` field for an access key — configure credentials the normal AWS
  way, outside the config file.
- **Errors** surface through the same `ProviderError` wrapping as every other provider type —
  nothing Bedrock-specific about the error shape. In practice, most Bedrock failures are
  account/model availability issues rather than `dh` misconfiguration: Bedrock model ids are
  region- and account-specific (a model enabled in one region/account may not be in another),
  and some ids that are syntactically valid are legacy or deprecated. An "invalid model" or
  "access denied" error is usually a sign to check model access in the AWS Bedrock console for
  that region/account, not a `dh.json` problem.
- **Prompt caching** (`ModelConfig.cache`, above) is supported via Bedrock's `cachePoint`
  blocks at the same three positions the Anthropic adapter uses.

### `type: "openai-compatible"` — OpenAI Chat Completions API and OpenAI-compatible endpoints

```json
{
  "provider": [
    { "name": "local-openai", "type": "openai-compatible", "baseURL": "http://localhost:1234/v1", "apiKey": "$(LOCAL_API_KEY)" }
  ],
  "models": [
    { "name": "local-model", "provider": "local-openai", "model": "some-openai-shaped-model-id" }
  ]
}
```

- **`baseURL`** — required. Points at any endpoint that speaks the OpenAI Chat Completions API
  (SSE-streamed) — `dh` has no dependency on the OpenAI SDK; it's a thin `fetch`-based client
  against `<baseURL>/chat/completions`, structurally the same "custom endpoint" shape as the
  `anthropic` type's `baseURL`, just OpenAI-message-shaped instead of Anthropic-message-shaped.
- **`apiKey`** (optional) — sent as `Authorization: Bearer <apiKey>` when set. Omit it for a
  local endpoint that doesn't require auth.
- **Tool calling** — OpenAI-shaped `tool_calls` are translated to and from `dh`'s internal tool
  representation; this is the provider type Amazon Bedrock Mantle's `mantle-openai` route uses,
  and it's live-verified working end to end with tool use (see
  `tracking/DH-0119-real-bedrock-mantle-integration-live-verified-mantle-anthropic-mantle-openai.md`).
- **Errors** — a connection failure (DNS, connection refused, TLS) classifies distinctly from
  an HTTP error response (4xx/5xx), same `ProviderError` taxonomy as the other two types.

### Amazon Bedrock Mantle — configured through the two types above, not a bespoke provider type

Bedrock Mantle is a distinct AWS endpoint from bedrock-runtime, with two model-vendor-routed
API surfaces, both bearer-`apiKey` authenticated — there is no `type: "bedrock-mantle"`;
instead you configure one `anthropic`-type and/or one `openai-compatible`-type provider
pointed at Mantle's URLs:

- **`mantle-anthropic`** — `type: "anthropic"`, `baseURL:
  "https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic"`. Anthropic Messages API shape.
- **`mantle-openai`** — `type: "openai-compatible"`, `baseURL:
  "https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1"`. Chat Completions shape — note the
  `/openai` path segment: some Mantle models (`gemma4` included) live on that prefixed path
  specifically; hitting the unprefixed path for them returns a misleading "Berm is not enabled
  for this account" error that has nothing to do with actual account access.

Both routes authenticate with the same key, conventionally interpolated as
`$(BEDROCK_MANTLE_API_KEY)` (not an AWS SDK credential chain call — a plain bearer token in the
`apiKey` field). `"haiku-mantle"` (via `mantle-anthropic`) and `"gemma4"` (via `mantle-openai`)
are both live-verified working end to end, tool-use included — see
`tracking/DH-0119-real-bedrock-mantle-integration-live-verified-mantle-anthropic-mantle-openai.md`.

`"gemma4"` connects fine (`dh doctor` PASSes it) but is **chat-only** — live testing found it
reliably hallucinates tool calls (fake fenced text describing a call, never a real `tool_use`/
`tool_calls` block) rather than actually performing agentic tool use, which is why it's in the
scaffolded menu but not `options.defaultModel`; `dh doctor` flags this distinctly rather than
as a plain `PASS`.

## Top-level options

- **`options.defaultModel`** — required; the model used when a tool/agent spawn doesn't name
  one.
- **`options.runInBackgroundDefault`** — overrides the default (`true`) for every
  async-capable tool.
- **`options.maxTurns`** — overrides the agent loop's default safety-valve turn cap (100) for
  every agent this runtime runs, root and sub-agents alike — the default exists to bound a
  pathological loop, not to constrain a legitimate long-running dark-factory task.
- **Session-wide budgets** (all optional; omitted means no cap of that kind):
  - **`options.maxCostUsd`** and **`options.maxTotalTokens`** cap cumulative spend/tokens
    across the whole session (root plus every sub-agent).
  - **`options.maxWallClockMs`** caps total duration independent of turn count.
  - **`options.maxConcurrentAgents`** caps how many agents can be live at once.
  - **`options.maxAgentDepth`** caps sub-agent nesting depth (the root is depth 0).

  A cost/token/wall-clock cap stops the whole session (every live agent), logging why to each
  agent's own JSONL stream; a fan-out cap refuses the specific `Agent` spawn that would exceed
  it, surfaced back to the spawning agent as a normal tool error.
- **`compaction`** (top-level, optional) — `{ "enabled": true, "thresholdPercent": 80 }` opts
  the session into context-window compaction: once a turn's reported context tokens
  (input + cache-read + cache-write + output) reach `thresholdPercent` (1-99, default 80) of
  the active model's `contextWindow`, the harness summarizes older history into a compact
  recap before continuing, rather than letting the provider reject an oversized request.
  Requires every configured model to declare `contextWindow` (config-load-time error
  otherwise). Omitted entirely (the default) means compaction never runs; a context-window
  overflow instead fails the agent with an actionable message.
- **`$(VAR)`** in any string value resolves against the environment at load time — e.g.
  `"apiKey": "$(ANTHROPIC_API_KEY)"`. To use a literal `$(...)`-shaped string (meant for
  something other than `dh`'s own interpolation — e.g. a value a Bash tool call's subprocess
  should see verbatim), escape it as `$$(...)`: `$$(FOO)` resolves to the literal text
  `$(FOO)`, with no environment lookup attempted.
- **`skillPaths`** — directories scanned for skill folders (each containing a `SKILL.md`, the
  same convention Claude Code uses). `dh` also always bundles a `cli-tools` skill covering
  `git`, `gh`, `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`, and `curl` — no
  config needed for that one.
- **`mcpServers`** — a Claude Code-style map of MCP server definitions (stdio and HTTP), each
  with an optional `timeoutMs` overriding the connect/call timeout defaults. `dh` connects to
  every configured server at startup and folds its real tools into `ToolSearch`'s corpus
  (`select:Name1,Name2` exact selection/activation, `+term` filtering, keyword ranking,
  `max_results`) — an unreachable server degrades gracefully rather than failing startup. See
  [MCP server configuration examples](mcp-servers.md).
- **`systemPrompt`** — optional path to a file whose contents replace the built-in
  working-discipline preamble. The `TASK_FAILED`/logging contract the harness's own exit-code
  behavior depends on is always appended after it regardless.
- **`security`** — see [Security](#security-bearer-token--tls) below.
- **`limits.completedRetention`** — caps how many terminal/completed entries the harness's
  in-memory structures (e.g. the task registry) retain before evicting the oldest, so a
  long/wide-fanout session's memory footprint reflects currently-relevant agents rather than
  every agent ever spawned. Optional; defaults to 50. Active (running/waiting) entries are
  never evicted regardless of count.
- **`logRetention`** — optional `.dh-logs/` rotation policy: `maxAgeMs` deletes a session
  directory once its most recently written file is older than that; `maxTotalBytes` then
  deletes the oldest remaining session directories (by last write) until total size is back
  under the cap. Both independent and optional; omitted means no pruning (the default).
- **`web`** — optional outbound-web opt-in (`WebFetch`/`WebSearch`); absent by default, which
  means those tools don't exist at all, not just disabled. See
  [Optional web access](#optional-web-access-webfetch--websearch) below.

## Security: bearer token + TLS

```json
{
  "security": {
    "token": "$(DH_TOKEN)",
    "tls": { "cert": "/path/to/cert.pem", "key": "/path/to/key.pem" },
    "hostname": "127.0.0.1"
  }
}
```

- **`security.token`** — when set, every request (POSTs and SSE connections alike) must carry
  `Authorization: Bearer <token>` or gets a bare `401`. Constant-time compared, never logged.
  A connecting client supplies its own token via its own `dh.json`.
- **`security.tls`** — cert/key paths serve HTTPS directly on the same port. Both are
  independent and optional — token without TLS, TLS without token, both, or neither (the
  default). `--connect` dials `https://` automatically when the *connecting* side's own
  `dh.json` sets `security.tls`.
- **`security.hostname`** — opt-in bind address for the server (e.g. `"127.0.0.1"` for
  loopback-only). Omitted means Bun's own default (all interfaces). Applies to both the
  `--server` process and the web UI's static server. Config-only, not a CLI flag.

Rationale and scope: [`docs/adr/0004-security-posture.md`](adr/0004-security-posture.md).

## Keeping secrets out of `dh.json`: `--env <file>`

`--env <file>` loads a dotenv-style file into the process environment *before* `dh.json` is
loaded — so its `$(VAR)` interpolation can resolve against it. The supported subset is
deliberately minimal, not a full reimplementation of any particular dotenv tool's dialect:

- `KEY=VALUE` per line; blank lines and lines starting with `#` (after trimming leading
  whitespace) are skipped as comments — `#` is *not* treated as an inline/trailing comment
  marker within a value (a value containing `#` is taken literally, in full).
- A value may be wrapped in double quotes (`"..."`), which are stripped, with `"`, `\`, `\n`,
  and `\t` escape sequences resolved inside them.
- A value may instead be wrapped in single quotes (`'...'`), which are stripped with **no**
  escape processing at all — the content between the quotes is used completely literally (the
  one way to include a literal `#`, backslash, or double-quote without any escaping).
- An unquoted value is used as-is (after trimming surrounding whitespace), with no escape
  processing.

The intended workflow: keep a gitignored `secrets.env` (populated however you like — by hand,
or via tooling like Doppler) holding real API keys, and commit a fully-functional `dh.json`
that references them only as `$(ANTHROPIC_API_KEY)` etc. No secrets ever land in the repo, but
the committed config is a real, runnable example:

```
# secrets.env (gitignored — see .gitignore)
ANTHROPIC_API_KEY=sk-ant-...
```

```json
{ "provider": [{ "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" }] }
```

```
dh --env secrets.env
```

`.gitignore` excludes `secrets.env` specifically, plus `*.env` generally.

## Git credentials and workspace convention

`dh` has no `workspaceDir`-style config field and does no repo checkout of its own — the
canonical "clone a repo and work on it" scenario is entirely the operator's responsibility to
set up before starting `dh`. The convention:

- **Working directory is the workspace.** The `Bash` tool runs every command at the process's
  own current working directory (`process.cwd()` at `dh` startup) — there is no separate
  configured workspace path. Start `dh` with its working directory already set to the
  checked-out repo (e.g. a container's `WORKDIR`, or `cd`'d into the repo before invoking `dh`
  on the host). `dh.json` itself is looked up relative to that same directory by default
  (`--config` to override).
- **Git credentials are the container's/host's responsibility, not `dh.json`'s.** There is no
  credential field in the config schema — `git` inside a `Bash` call authenticates exactly as
  it would for a human at that same shell prompt. Recommended patterns, in order of how most
  dark-factory deployments set this up:
  - **Mounted SSH key** — mount a deploy key at `~/.ssh/id_ed25519` (read-only, correct
    permissions) with `known_hosts` pre-populated or `StrictHostKeyChecking=no` in
    `~/.ssh/config` for known-good hosts (e.g. `github.com`). Works with `git@host:org/repo`
    remotes with no further config.
  - **`GIT_ASKPASS`** — set `GIT_ASKPASS` to a small script that echoes a token from the
    environment, and use HTTPS remotes. Useful when a platform makes injecting an SSH key
    awkward but env vars easy (most container schedulers).
  - **`.netrc`** — a mounted or generated `~/.netrc` with `machine <host>` / `login` /
    `password <token>` entries; `git` over HTTPS reads this automatically with no
    per-invocation flag.
  - **PAT via env + credential helper** — set a personal-access-token env var and configure
    `git config --global credential.helper` to a one-liner that prints it; combine with
    `--env secrets.env` (above) to keep the token out of `dh.json`.

  None of these are `dh`-specific — they're the same options as any other headless git
  automation. `dh` does not special-case any of them; whichever one is already set up in the
  environment `dh` starts in is what its agents inherit.

## Running air-gapped

`dh`'s default posture — plaintext HTTP, no auth, no approval prompts — is built around
running on a network you already trust, per
[`docs/adr/0004-security-posture.md`](adr/0004-security-posture.md). Practically, that means:

- **`dh` makes no outbound calls of its own** other than to whichever model provider(s) your
  `dh.json` configures, plus whatever a running agent's own `Bash`/`git`/tool calls choose to
  reach (your instructions file controls that, not the harness) — and, if you've deliberately
  opted in, `WebFetch`/`WebSearch` (see below). There's no telemetry, update-checker, or other
  phone-home behavior.
- **Fully offline is possible** if you point `provider` at a local, Anthropic-compatible
  endpoint (`type: "anthropic"` with a `baseURL` set via the `$(LOCAL_AI_PROVIDER)` env-var
  interpolation, as the scaffolded config's `"local"` provider does — e.g.
  `LOCAL_AI_PROVIDER=http://localhost:8080`), or an `openai-compatible` local endpoint — e.g.
  LM Studio or any other local inference server speaking one of those API shapes. With a local
  provider and no other outbound tool calls, a container running `dh` needs no network egress
  at all.
- **The recommended deployment boundary is a container**, on a private network, behind an SSH
  tunnel, or behind a reverse proxy you control — never with a headless `--server`'s port
  exposed directly to the open internet. See [Container deployment](deployment.md) for a
  reference `Dockerfile` and run patterns (unattended job, headless server + remote client,
  secret injection, log persistence).
- **If you can't fully air-gap**, layer on `security.token` (bearer auth on every request)
  and/or `security.tls` (HTTPS on the same port) — both opt-in, both described above. Neither
  adds user accounts or per-agent scopes; air-gapping is still the stronger control even with
  both enabled.

### Optional web access (`WebFetch` / `WebSearch`)

`dh` ships two more tools an agent can use to look things up on the open internet —
`WebFetch` (fetch a URL's content) and `WebSearch` (run a search query) — but **both are
absent by default**, not just disabled: unless you add a `web` block to `dh.json`, neither
tool exists at all, and no code path in `dh` makes an outbound call to anything other than
your configured model provider(s). Enabling either is a deliberate, per-tool decision that
**breaks the air-gapped posture** described above — do this only if your deployment isn't
meant to be air-gapped, and understand that it hands your agent (and, transitively, whatever
web content it fetches) a live route to the open internet.

```json
{
  "web": {
    "fetch": {
      "allowedHosts": ["docs.example.com"],
      "extractionModel": "haiku"
    },
    "search": {
      "provider": "brave",
      "apiKey": "$(BRAVE_API_KEY)"
    }
  }
}
```

- **`web.fetch`** — presence registers `WebFetch`; an empty `{}` is a valid minimal opt-in
  (every field has a default). It fetches `http`/`https` URLs only, never follows redirects
  automatically (a 3xx is reported back instead), and refuses private/loopback/link-local
  addresses by default (SSRF protection) — set `allowPrivateNetwork: true` only if you
  deliberately want it to reach an internal docs server, and consider pinning `allowedHosts`
  to the specific domains your agents actually need. If `extractionModel` names a configured
  model, a `prompt` argument is answered against the fetched page by that model (its usage
  counts toward your `options.maxCostUsd`/`maxTotalTokens` budgets, same as any other model
  call) instead of dumping raw page content back to the caller.
- **`web.search`** — `dh` has no search infrastructure of its own, so this tool only exists
  once you configure a backend; v1 supports the Brave Search API (`provider: "brave"` +
  `apiKey`, `$(VAR)`-interpolatable). **Brave's API is not free** (as of this writing it's
  prepaid metered credits, roughly $3–5 per 1,000 queries) — enabling `web.search` is a real,
  ongoing operator cost, not just a security decision.
- **`web.search.apiKey` is never logged** — it joins the same redaction set as
  `security.token` and every provider `apiKey` (see
  [`docs/adr/0004-security-posture.md`](adr/0004-security-posture.md)'s logging-redaction
  notes).
- **Air-gapped deployments should leave `web` unset entirely** rather than configuring it and
  expecting it to sit unused — its mere presence is what registers the tool.
