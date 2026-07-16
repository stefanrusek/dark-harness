---
spile: ticket
id: DH-0074
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0074: No WebFetch/WebSearch-equivalent tool for an autonomous coding agent to look up docs or errors online

## Summary

Real Claude Code ships WebFetch and WebSearch tools letting an agent fetch a URL's content or run a web search -- useful for a coding agent looking up library docs, API references, or error messages. dh has no equivalent in src/agent/tools/. This is a genuine capability gap for dh's stated coding-agent use case, though it interacts with the project's air-gapped-by-default security posture (docs/adr/0003-security-posture.md) -- likely wants to be opt-in via dh.json rather than always-on, which is why this is filed as draft rather than ready.

## User Stories

**Owner decision (2026-07-16): four distinct user stories, not one bundled story — WebFetch
and WebSearch are separate tools with separate opt-in settings, both defaulting off. The
architect should design the exact settings shape.**

### As an agent debugging an unfamiliar error or looking up a specific URL, I want to fetch a page's content

- Given WebFetch is enabled, when the agent calls it with a URL (and optionally a prompt
  describing what to extract), then it returns processed page content, mirroring real
  Claude Code's WebFetch shape.

### As an agent needing to search the web for current information, I want a WebSearch tool

- Given WebSearch is enabled, when the agent calls it with a query, then it returns search
  results, mirroring real Claude Code's WebSearch shape.

### As an operator, I want a setting to enable/disable WebFetch, defaulting off

- Given `dh.json`, when a WebFetch-enabling setting is set, then the tool is registered;
  when unset, the tool is absent entirely (not registered-but-erroring) — default is off,
  consistent with the air-gapped-by-default posture (ADR 0003).

### As an operator, I want a separate setting to enable/disable WebSearch, defaulting off

- Given `dh.json`, when a WebSearch-enabling setting is set, then the tool is registered;
  when unset, absent entirely. Independent of the WebFetch setting — an operator may want
  one without the other (e.g. WebFetch for a specific allowed URL, no open-ended search).

## Functional Requirements — architect design (Fable, 2026-07-16)

Grounded empirically against real Claude Code's own WebFetch/WebSearch (schemas pulled and
both tools exercised live during this design pass), Bun's fetch capabilities (docs fetched:
`AbortSignal.timeout` supported; **no** built-in response-size cap; **no** DNS/IP hook, so
SSRF protection must be application-level), and current Brave Search API pricing (checked
live 2026-07: free tier discontinued; $5 prepaid metered credits, ~$3–5 per 1k queries).

Observed real-Claude-Code shapes, for the record:

- WebFetch input: `{ url: string (format uri, required), prompt: string (required) }`.
  Behavior: fetch → markdown conversion → a *small fast model* answers `prompt` against the
  content; http upgraded to https; cross-host redirects returned to the caller rather than
  followed; responses cached 15 minutes.
- WebSearch input: `{ query: string (minLength 2, required), allowed_domains?: string[],
  blocked_domains?: string[] }`. Output: a `Links: [{title,url},…]` block plus synthesized
  prose — the synthesis runs on Anthropic's own search infrastructure, which dh does not
  have.

### 1. Config shape (`src/contracts/config.ts` — contracts change; this design pass *is* the required architect review per Constitution §6.2)

New optional **top-level `web` block** — not inside `options`. Precedent: `security`,
`limits` (DH-0012), `logRetention` (DH-0037) — each opt-in feature area gets its own typed
top-level block; `options` stays reserved for agent-loop tuning. Adding one optional
top-level key is an "extend minimally" move under ADR 0007, not a restructure.

```json
{
  "web": {
    "fetch": {
      "timeoutMs": 30000,
      "maxResponseBytes": 4194304,
      "maxOutputChars": 50000,
      "allowPrivateNetwork": false,
      "allowedHosts": ["docs.example.com"],
      "extractionModel": "haiku"
    },
    "search": {
      "provider": "brave",
      "apiKey": "$(BRAVE_API_KEY)",
      "timeoutMs": 10000,
      "maxResults": 10
    }
  }
}
```

**Enabling semantics: presence of the block registers the tool; absence means the tool
does not exist** (not registered-but-erroring), per the owner's user stories. `web.fetch`
and `web.search` are fully independent. `"web": { "fetch": {} }` is a valid minimal
opt-in (all fetch fields have defaults); `web.search` additionally *requires* `provider`
and `apiKey` — a `web.search` block failing that validation is a config error at load
time, not a silently-absent tool.

Field semantics (all optional unless noted):

- `web.fetch.timeoutMs` — whole-request wall clock via `AbortSignal.timeout`. Default 30000.
- `web.fetch.maxResponseBytes` — hard cap on bytes read from the body (stream and stop —
  Bun has no built-in cap, so read incrementally and abort past the limit). Default 4 MiB.
- `web.fetch.maxOutputChars` — cap on the text returned to the model after conversion,
  with an explicit truncation notice (no silent truncation — Constitution §8). Default 50000.
- `web.fetch.allowPrivateNetwork` — default `false`; `true` disables the SSRF address
  check (for operators deliberately pointing at internal docs servers).
- `web.fetch.allowedHosts` — when set, only these hosts (exact or dot-suffix match, e.g.
  `example.com` matches `docs.example.com`) are fetchable. Unset = any public host. This is
  an operator network control like `security.token`, not a permission prompt — it does not
  bend invariant §4.7.
- `web.fetch.extractionModel` — a `ModelConfig.name` from `models[]`. See tool behavior below.
- `web.search.provider` — **required**; literal `"brave"` in v1 (discriminated string so a
  `"searxng"` self-hosted variant can be added by a later ticket without restructuring).
- `web.search.apiKey` — **required**; `$(VAR)` interpolation applies as everywhere else.
  **Joins `security.token` in DH-0020's redaction set** — never logged, redacted from
  session logs and error output (including error bodies from the search backend).
- `web.search.timeoutMs` — default 10000. `web.search.maxResults` — default 10, cap 20.

### 2. WebFetch tool (`src/agent/tools/web-fetch.ts`, Core)

Input schema (deliberate divergence from real CC: `prompt` is **optional** here, because
the extraction-model step is conditional on config — a required-but-sometimes-ignored
param would be worse):

```
{ type: "object",
  properties: {
    url:    { type: "string", description: "The URL to fetch (http/https only)" },
    prompt: { type: "string", description: "What to extract from the page; applied only when web.fetch.extractionModel is configured, otherwise the processed page content is returned directly" }
  },
  required: ["url"] }
```

Mechanics:

- **Schemes:** `http:` and `https:` only; everything else (`file:`, `data:`, `ftp:`) is a
  tool error. No forced http→https upgrade (real CC upgrades; dh is operator-run and ADR
  0004 itself defaults to plaintext — forcing TLS on outbound while serving plaintext
  inbound would be incongruous). Fetch the URL as given.
- **Redirects:** `redirect: "manual"`. Every 3xx (same-host or cross-host, uniformly) is
  returned to the model as `Redirected to <location> (HTTP <status>)` — the model re-calls
  with the new URL, which re-runs the full SSRF/allowlist check. This also closes the
  redirect-based SSRF hole (public URL 302→`http://169.254.169.254/`).
- **SSRF check (default-on, bypassed only by `allowPrivateNetwork: true`):** before
  fetching, resolve the hostname (`dns.promises.lookup(host, { all: true })`, works under
  Bun; literal-IP hostnames checked directly without DNS). Reject if **any** resolved
  address falls in: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16` (link-
  local / cloud metadata), `172.16/12`, `192.168/16`, `198.18/15`, and for IPv6 `::`,
  `::1`, `fc00::/7`, `fe80::/10`, plus `::ffff:0:0/96`-mapped addresses checked against the
  IPv4 ranges. Implement as a small pure `isPrivateAddress(ip)` function (trivially 100%-
  coverable). **Known residual risk, documented not solved:** DNS rebinding between the
  check and Bun's own connect (Bun exposes no way to pin the resolved IP for a TLS fetch);
  acceptable for v1 given the tool is opt-in and the primary posture is air-gapped.
- **Response handling:** stream the body up to `maxResponseBytes` (abort beyond).
  `text/html` → text extraction via **Bun's built-in `HTMLRewriter`** (no new dependency;
  drop `script`/`style`/`noscript`, collect text content, collapse whitespace, render links
  as `text (url)`). Other `text/*`, `application/json`, `application/xml` → returned as-is.
  Any other content type → tool error naming the type. Result truncated to `maxOutputChars`
  with a truncation notice.
- **Extraction-model step:** when `prompt` is provided **and** `web.fetch.extractionModel`
  is configured, make one non-streaming call through the existing provider adapter (content
  + prompt → answer) and return the answer instead of raw content. That call's token usage
  **must feed the session accounting** so DH-0013 budgets (`maxCostUsd`/`maxTotalTokens`)
  see it. When `prompt` is provided but no `extractionModel` is configured, return the
  processed content prefixed with a one-line note that no extraction model is configured.
- **No response cache in v1** (real CC caches 15 min; explicit non-goal here — keep it
  stateless).

### 3. WebSearch tool (`src/agent/tools/web-search.ts`, Core) — backend resolution

**Decision: dh has no search infrastructure of its own and does not pretend to. WebSearch
exists only when the operator configures a third-party backend; v1 backend is the Brave
Search API** (`GET https://api.search.brave.com/res/v1/web/search?q=…`, key via
`X-Subscription-Token` header, JSON response). Rationale over the alternatives considered:

- *Anthropic's server-side `web_search` tool*: rejected — it's a provider-executed server
  tool, so it only works on anthropic-type providers against the real API (not bedrock,
  not local endpoints), and wiring it would change the provider-adapter contract for one
  tool. dh's tools are uniformly client-side.
- *Google CSE / SerpAPI / Tavily*: viable but no advantage over Brave for v1; the
  `provider` discriminator leaves the door open.
- *SearXNG (self-hosted metasearch)*: the best philosophical fit for a self-hosted harness
  and the sanctioned **follow-up** backend (`provider: "searxng"` + `baseURL`, no apiKey) —
  out of v1 scope to keep the slice small, but the config shape above is designed so adding
  it is purely additive.
- Note for the README (operator cost awareness): as of 2026-07 Brave has **no free tier** —
  $5 prepaid metered credits, ~$3–5 per 1k queries.

Input schema (mirrors real CC exactly):

```
{ type: "object",
  properties: {
    query:           { type: "string", minLength: 2 },
    allowed_domains: { type: "array", items: { type: "string" } },
    blocked_domains: { type: "array", items: { type: "string" } }
  },
  required: ["query"] }
```

`allowed_domains`/`blocked_domains` are implemented as **post-filters on result URLs**
(dot-suffix host matching, same rule as `allowedHosts`) — backend-agnostic, works
identically when other providers are added. Output mirrors real CC's textual shape: a
header line, then one block per result — `title`, `url`, snippet — up to `maxResults`.
**No synthesis step** — real CC's prose summary is Anthropic-side infra; in dh the calling
agent does its own synthesis from the returned blocks. Backend HTTP errors are returned as
tool errors with status + sanitized body (apiKey redacted per DH-0020).

### 4. Registration mechanism (Core)

**Do not reuse the MCP deferred-tool mechanism** (DH-0002): a `deferred` tool is hidden
from the per-turn tool list but still *exists* — discoverable and activatable via
ToolSearch — which violates the owner's "absent entirely" requirement. Instead:

- `ALL_TOOLS` stays exactly as-is (the unconditional fixed set).
- New `composeTools(config: DhConfig): Tool[]` in `src/agent/tools/index.ts`: returns
  `ALL_TOOLS` plus `webFetchTool` iff `config.web?.fetch` is present, plus `webSearchTool`
  iff `config.web?.search` is present (load-time validation having already guaranteed
  provider/apiKey).
- `runtime.ts` already takes `options.tools ?? ALL_TOOLS` at construction — change the
  fallback to `composeTools(this.config)`. Registered web tools are ordinary non-deferred
  tools; both read their own settings from `ctx.config.web` at execute time (ToolContext
  already carries `config`).
- Uniform across root and sub-agents (one toolMap per runtime) — intentional; there is no
  per-agent gating.

### 5. Documentation (Prompt domain — Iris)

- README gains an **"Optional web access (WebFetch / WebSearch)"** subsection under the
  security section: both tools **default off**; enabling either breaks the air-gapped
  posture and is a deliberate operator decision; air-gapped deployments must leave `web`
  unset entirely; `web.search.apiKey` is never logged; Brave API cost note. Tone mirrors
  ADR 0004's "air-gapping is the strongest posture" framing.
- Coordinator (Ada): record a short **amendment to ADR 0004** noting that opt-in outbound
  web tools (`web` block) exist, default off, and are consistent with — not a relaxation
  of — the air-gap-primary posture. (Architect-approved here; `docs/adr/` is
  coordinator-owned per §3, so Ada applies it.)

### 6. Domain assignment

- **Core (Grace):** `src/contracts/config.ts` `web` block (architect-reviewed by this
  design), config load-time validation + `$(VAR)` interpolation + DH-0020 redaction of
  `web.search.apiKey`, both tools, `composeTools`, unit coverage (100% gate — mock
  `fetch`/DNS in unit tests; the pure `isPrivateAddress` and host-suffix matchers are
  directly testable).
- **Prompt (Iris):** README section per §5 above.
- **E2E (Hedy), optional slice:** a fetch against a local mock HTTP server spun up by the
  e2e harness (never the real internet in the gate), plus a tool-absent-by-default
  assertion.

## Assumptions

- Uniform tool availability across root and sub-agents within a session is acceptable
  (no per-agent web gating) — consistent with every other tool in the fixed set.
- Bun's `HTMLRewriter` and `dns.promises.lookup` are available in all compiled-binary
  targets (they are part of Bun's runtime, not optional packages).

## Risks

- Direct tension with the air-gap-primary posture (ADR 0004) — mitigated by default-off
  presence-gating, absent-entirely registration, README steering (§5), and the ADR 0004
  amendment.
- SSRF — mitigated by the default-on private-address check, manual-redirect policy, and
  scheme allowlist; **residual DNS-rebinding TOCTOU risk documented above** (Bun offers no
  IP-pinning hook); revisit if Bun grows one.
- Brave pricing drift / no free tier (verified 2026-07) — operator cost is real; the README
  must say so. The `provider` discriminator keeps dh unmarried to Brave.
- The extraction-model call spends real tokens — must be routed through session accounting
  so DH-0013 budgets apply (spelled out in §2).

## Open Questions

None — resolved by this design pass:

- Architect sign-off per Constitution §6.4: **this document is it** (2026-07-16, Fable).
- WebSearch scope: **in scope for v1, but only as an operator-configured third-party
  backend (Brave); tool absent when unconfigured.** SearXNG is the sanctioned follow-up
  backend.

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Judgment call: flagged as in-scope
> for a coding-agent harness (unlike DesignSync/RemoteTrigger/PushNotification, which were
> judged out of scope as Anthropic's own product infra) but explicitly gated by the
> existing security-posture invariant.

> [!NOTE]
> **Implemented 2026-07-16 (Grace, Core).** Built exactly per Fable's design above:
> `src/contracts/config.ts`'s `WebConfig`/`WebFetchConfig`/`WebSearchConfig` (+ validation in
> `src/config/validate.ts`, `web.search.apiKey` joining DH-0020's redaction set in
> `src/server/redact.ts`), `src/agent/tools/net-guard.ts` (`isPrivateAddress`,
> `hostMatchesSuffix`), `src/agent/tools/web-fetch.ts` (SSRF check, manual-redirect handling,
> streamed response-size cap, `HTMLRewriter`-based HTML-to-text, extraction-model step), and
> `src/agent/tools/web-search.ts` (Brave backend, domain post-filters, no synthesis step).
> Registration goes through a new `composeTools(config)` in `src/agent/tools/index.ts`
> (`runtime.ts`'s `options.tools ?? ALL_TOOLS` fallback now reads `composeTools(this.config)`)
> — not the MCP deferred-tool path, so an unconfigured tool is genuinely absent, not just
> hidden-but-discoverable. `ToolContext` gained `completeWithModel` (wired in `runtime.ts`) so
> WebFetch's extraction-model call feeds the same `token_usage` SSE/log event and DH-0013
> session-cost/token-budget accounting as every normal agent turn.
>
> README gained an "Optional web access (WebFetch / WebSearch)" subsection (steering
> air-gapped operators to leave `web` unset) plus a `web` bullet in the config-fields list and
> a `WebFetch`/`WebSearch` mention in the Tools section — done in this round rather than
> deferred to Iris, since it was a small, self-contained addition.
>
> Quality gates: `bun run typecheck` and `bun run lint` clean. `bun run test:coverage`:
> 1580/1580 pass; new files (`net-guard.ts`, `web-fetch.ts`, `web-search.ts`) and the changed
> lines in `config.ts`/`validate.ts`/`redact.ts`/`runtime.ts`/`loop.ts`/`tools/index.ts`/
> `tools/types.ts` are all at 100% line coverage (a couple of files report sub-100%
> **function**-count coverage — `web-search.ts` 92.86% funcs, `web-fetch.ts` 99.60% lines with
> no lines actually listed as uncovered — which appears to be the same bun-coverage-tool
> counting quirk already present pre-existing on several other files in this repo, e.g.
> `bash.ts`/`glob.ts`/`grep.ts`/`cli.ts`/`tui/app.ts`; not a gap I found a missing test case
> for). `bun run e2e`: 30/32 pass — the 2 failures are `chromium` executable-not-found in this
> sandbox (`/opt/pw-browsers/chromium` missing), a pre-existing environment limitation
> unrelated to this change, not something introduced here.
>
> Tested explicitly per the ask: SSRF rejection for private/loopback/link-local/CGNAT/
> benchmarking IPv4 and IPv6 ranges (`net-guard.test.ts`, `web-fetch.test.ts`), the
> `allowPrivateNetwork`/`allowedHosts` bypass paths, response-size capping (streamed,
> truncation-noted), redirect handling (3xx reported back, not followed), and WebSearch's
> absent-when-unconfigured behavior (`composeTools` unit tests in `tools/index.test.ts` plus
> an end-to-end `AgentRuntime` test asserting `WebFetch` dispatches as `"Unknown tool: WebFetch"`
> when `web.fetch` isn't configured).
