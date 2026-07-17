---
spile: ticket
id: DH-0107
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0106]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0107: Real Gemma 4 support requires a new provider type (Bedrock Mantle, OpenAI-compatible API)

## Summary

Real Gemma 4 (Google, released 2026-03-31; on AWS Bedrock since 2026-06-10) is reachable only via a distinct AWS product/endpoint, bedrock-mantle (https://bedrock-mantle.{region}.api.aws/openai/v1), an OpenAI-compatible Chat Completions/Responses API authenticated with a Bedrock long-term API key (bearer token) -- not the standard Bedrock Converse/Invoke SigV4 path dh's existing bedrock provider type uses, and not reachable via the standard on-demand ListFoundationModels catalog at all. dh's ProviderType (src/contracts/config.ts) currently only has 'anthropic' and 'bedrock' -- supporting real Gemma 4 needs a new provider type (an OpenAI-compatible chat-completions client) plus a new credential/auth shape (Bedrock long-term API key, distinct from the AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY SigV4 flow). This is a src/contracts/ change and needs architect sign-off per CLAUDE.md section 6, not a routine implementer dispatch. Model card notes Gemma 4 supports native function calling for agentic workflows but does NOT support parallel tool calls -- one call per turn only, which the Core agent loop would need to handle/serialize for this provider path specifically. Empirically confirmed live: bedrock-mantle.us-east-1.api.aws resolves to real AWS infrastructure and returns a correctly-shaped 405 on the documented endpoint.

## User Stories

### As an operator, I want to configure real Gemma 4 in `dh.json` and have it actually work end to end

- Given a `dh.json` provider entry pointing at Gemma 4, when the root or a sub-agent uses that
  model, then requests actually reach `bedrock-mantle.{region}.api.aws/openai/v1` via the
  OpenAI-compatible Chat Completions (or Responses) API, authenticated with a Bedrock
  long-term API key, and tool calls the model makes are real (`tool_use`-equivalent),
  round-tripping through the existing agent loop exactly like the `anthropic`/`bedrock`
  provider types do today.
- Given Gemma 4 only supports one tool call per turn (per its model card), when the agent
  loop would otherwise request/expect multiple, then this provider path handles that
  constraint correctly (serializes, or the loop is made aware of a per-provider tool-call
  cap) rather than silently dropping or malforming extra calls.

## Functional Requirements

- **Resolved by architect design below (2026-07-16):** new `ProviderType` value
  `"openai-compatible"` in `src/contracts/config.ts` (currently `"anthropic" | "bedrock"`) —
  a shared wire-truth change per CLAUDE.md §3/§6, signed off by Fable in the Architect Design
  section, same process as DH-0093's contracts round. Scoped to exactly that one union member;
  no other `ProviderConfig` field changes.
- New provider adapter `src/agent/providers/openai-compatible.ts` (parallel to
  `anthropic.ts`/`bedrock.ts`, structurally closer to `anthropic.ts` — see Architect Design
  §1/§4) speaking the OpenAI-compatible Chat Completions API against an operator-supplied
  `baseURL` (for Mantle: `https://bedrock-mantle.{region}.api.aws/openai/v1`, region baked in
  by the operator, not templated by the adapter).
- Credential shape: reuse the existing `apiKey` field (already generic bearer-token-shaped,
  already `$(VAR)`-interpolated, already covered by DH-0020 redaction regardless of provider
  type — see Architect Design §3). No new field. The Bedrock long-term API key (bearer token,
  generated via the AWS Bedrock console — distinct from the SigV4 `AWS_ACCESS_KEY_ID`/
  `AWS_SECRET_ACCESS_KEY` flow the `"bedrock"` provider type uses) goes in `apiKey` exactly
  like an Anthropic key does today.
- Model ids per the AWS model card: `google.gemma-4-31b`, `google.gemma-4-26b-a4b`,
  `google.gemma-4-e2b` (dense/MoE/small variants) — confirm the exact current set live before
  shipping a scaffold entry (per this project's live-verification discipline, and because
  Gemma 4 is a very recent, still-evolving release as of this ticket's filing).
- Single-tool-call-per-turn constraint: determine whether this needs agent-loop awareness or
  can be handled entirely within this provider adapter (e.g. by only ever sending/requesting
  one tool per turn to this provider) — an architect-level call given it may touch shared loop
  behavior.
- Once designed and implemented, add a real, live-verified `gemma4-mantle` (or similar) entry
  to `dh init`'s scaffolded model menu — not as `defaultModel` unless/until it's proven as
  reliable as the Claude tiers already are (see DH-0106, which moved the default away from the
  wrong Gemma 3 substitute).

## Assumptions

- Region availability per AWS docs at time of research: us-east-1, us-east-2, us-west-2,
  eu-central-1 — reconfirm live before shipping, Bedrock region support changes over time.
- This is purely additive (new provider type) — no change to the existing `anthropic`/
  `bedrock` provider types or their behavior.

## Risks

- Gemma 4 on Bedrock Mantle is a very new product (weeks old as of this ticket) — expect
  rough edges, possible API surface changes, and don't over-invest in a rigid integration
  before confirming the real API's stability empirically.
- A bearer-token credential type is a new secret shape flowing through `dh.json`/`--env` —
  make sure it gets the same redaction treatment (DH-0020) as existing API keys, not
  overlooked because it's structurally different from the SigV4 pair.

## Open Questions

Both resolved below by the architect design — see that section for the reasoning.

## Architect Design (Fable, 2026-07-16)

Read `src/contracts/config.ts`, `src/config/validate.ts`, `src/agent/providers/{types,anthropic,bedrock,index}.ts`,
and `src/server/redact.ts` before writing this. Findings and decision:

**1. This is a new adapter type, not a Bedrock variant — the ticket's framing needs
correcting.** `bedrock.ts` is structurally defined by two things Mantle does *not* have: the
AWS SDK's `BedrockRuntimeClient`/`ConverseStreamCommand` wire shape, and the ambient AWS
SigV4 credential chain (no `apiKey` field even exists in `bedrock`'s validated key set —
`PROVIDER_TYPE_KEYS.bedrock = {"region"}` in `src/config/validate.ts:30`). Mantle is a plain
HTTPS endpoint, OpenAI Chat-Completions-shaped request/response, bearer-token auth. That is
categorically the same shape as the existing `anthropic` adapter (custom `baseURL` + `apiKey`,
already used today for "any Anthropic-compatible endpoint" per `anthropic.ts`'s own header
comment) — Mantle just isn't Anthropic-message-shaped, so it can't reuse `AnthropicProvider`
itself, but it reuses everything about *how* `anthropic`-type providers are configured. Building
it as a Bedrock variant would mean dragging in the AWS SDK, SigV4, and Converse-specific
plumbing for an endpoint that uses none of that — wrong shape entirely.

**2. New `ProviderType`: `"openai-compatible"`, not `"bedrock-mantle"`.** This directly
resolves the ticket's second Open Question, and resolves it as generalize: yes. A
vendor-specific name would immediately raise the same question again the next time an
OpenAI-Chat-Completions-shaped endpoint shows up (the ticket itself notes LM Studio already
piggybacks on `"anthropic"` via `baseURL`, which is the wrong-shaped adapter for it too —
this type is the correct home for that case as well as Mantle, though migrating the LM Studio
scaffold entry is not in scope here). One adapter, reusable for any OpenAI-compatible
endpoint an operator points a `baseURL` at — Mantle, LM Studio, or a future vendor — with no
new naming question needed next time.

**3. No new credential field — reuse `apiKey` + `baseURL` as-is.** The ticket's Functional
Requirements section asks for "a new field" for the Bedrock long-term API key. That's not
needed: `apiKey` is already a generic bearer-token-shaped secret slot (used today by
`anthropic`-type for exactly this — see `AnthropicProvider`'s constructor passing it straight
through as `apiKey`), already gets `$(VAR)` interpolation like every other config value
(interpolation is applied to the whole parsed config before validation, not per-field), and —
confirmed by reading `src/server/redact.ts:126-141` (`collectConfigSecrets`) — is already
swept into the DH-0020 redaction set generically: `for (const provider of config.provider ??
[]) { if (provider.apiKey) secrets.push(provider.apiKey); }` has no `type` branch at all. A
Mantle long-term API key dropped into `apiKey` gets redaction for free, today, unmodified.
Adding a differently-named field (e.g. `bearerToken`) would be pure surface-area growth with
no behavioral benefit and a real cost: it would need its own line added to
`collectConfigSecrets` or silently ship unredacted. Reuse is strictly better here. The
region-in-hostname requirement (`bedrock-mantle.{region}.api.aws/openai/v1`) is the
operator's problem to solve when writing `dh.json`, the same way any custom endpoint is today
— they set `baseURL` to the fully-resolved URL for their region; no adapter-side region
templating is needed or wanted (`bedrock`-type's separate `region` field exists because the
AWS SDK client takes a bare region and builds the URL itself; an HTTP-endpoint adapter has no
such SDK to hand a bare region to).

**4. Chat Completions API, not Responses.** This resolves the ticket's first Open Question.
Chat Completions is a single request → single response (or SSE-streamed) shape with a flat
`messages` array and a `tools`/`tool_calls` field — it maps directly onto this project's
existing `ProviderCompletionRequest`/`ProviderCompletionResult` internal interface
(`src/agent/providers/types.ts`) with no new state model, exactly like `anthropic.ts` and
`bedrock.ts` already do. The Responses API's server-side conversation-state model (`previous_
response_id`, stored server-side items) doesn't correspond to anything the agent loop or the
`ModelProvider` interface currently models, and adopting it would mean either faking statelessness
back on top of it (defeating its purpose) or introducing an new provider capability the loop has
to branch on. No reason to take that on for a first cut — ticket's summary already describes
the target as "Chat Completions/Responses"; pick Chat Completions.

**5. Single-tool-call-per-turn: adapter-internal, no agent-loop change.** This resolves the
ticket's remaining architect-flagged question. `ModelProvider.complete()`'s contract already
returns an arbitrary-length `content: ProviderContentBlock[]` per turn — the loop does not
assume or require more than one `tool_use` block, it just handles however many the adapter's
`content` array contains (zero, one, or several). A Gemma-4-via-Mantle turn will structurally
only ever contain at most one `tool_use` block because that's what the model itself emits;
the new adapter has nothing to serialize or cap on the way *in* since it never needs to send
multiple pending tool results in a way that would prompt multiple simultaneous calls out. No
`loop.ts` change, no new per-provider capability flag. If real usage later reveals an actual
mismatch (e.g. the loop wants to send several `tool_result` blocks in one user turn and Mantle
chokes on more than one), that's a concrete bug report against the new adapter, not something
to speculatively design against now.

**6. `src/contracts/` change required, scoped to one line.** `ProviderType` in
`src/contracts/config.ts:24` becomes `"anthropic" | "bedrock" | "openai-compatible"`. This
architect sign-off covers exactly that addition — no other contracts file changes. Everything
else (adapter implementation, `PROVIDER_TYPES`/`PROVIDER_TYPE_KEYS` in `src/config/validate.ts`
adding an `"openai-compatible": new Set(["baseURL", "apiKey"])` entry, wiring into
`createProvider` in `src/agent/providers/index.ts`) is routine Core-domain implementation
work, not a further contracts change — `ProviderConfig`'s shape (`baseURL`, `apiKey`, `retry`)
already covers this type with zero new fields.

**Implementation shape for Core** (not binding beyond what's stated above — normal
implementer judgment applies to the rest): new `src/agent/providers/openai-compatible.ts`
implementing `ModelProvider`, translating `ProviderCompletionRequest` to/from OpenAI Chat
Completions JSON (`role`/`content`/`tool_calls` on the request side, `choices[0].message` +
`finish_reason` on the response side — streaming via SSE `data:` chunks, following the same
`consumeXStream`-accumulator pattern `anthropic.ts`/`bedrock.ts` already use so `onTextDelta`
streaming and the DH-0044 `emittedAny`-gated retry convention carry over unchanged). Use plain
`fetch` against `${baseURL}/chat/completions` with `Authorization: Bearer ${apiKey}` — no new
SDK dependency needed for an OpenAI-compatible HTTP surface this thin. Error classification
(`ProviderErrorKind`) follows HTTP status the same way `anthropic.ts`'s `classifyAnthropicError`
does (401/403 → auth, 429 → rate_limit, 5xx → overloaded, connection failure → network).

Model ids, exact region list, and the `dh init` scaffold entry remain implementer-verified
live per the ticket's existing Functional Requirements and Assumptions — unchanged by this
design, and explicitly flagged in those sections as needing live reconfirmation regardless of
who implements this.

## Notes

> [!NOTE]
> Split out from DH-0106 (2026-07-16): the owner's original DH-0096 ask was for a working
> Gemma 4 config, but DH-0096's implementation silently substituted Gemma 3 (reachable via
> the standard Bedrock Converse API) because real Gemma 4 isn't reachable that way at all —
> confirmed via live investigation (DNS + a real `405 Method Not Allowed` response from
> `bedrock-mantle.us-east-1.api.aws`, matching AWS's documented API contract exactly).
> Routing to Fable for architect design given the `src/contracts/` touch, per CLAUDE.md §6.

> [!NOTE]
> 2026-07-16: Implementer pass complete — new `src/agent/providers/openai-compatible.ts`
> adapter, `ProviderType` extended with `"openai-compatible"` in `src/contracts/config.ts`,
> `PROVIDER_TYPE_KEYS` updated in `src/config/validate.ts`, wired into `createProvider` in
> `src/agent/providers/index.ts`. Verified with `bun run typecheck` (clean), `bun run lint`
> (0 new errors — pre-existing 9 errors are all in unrelated `.claude/skills/forked-subagent/`
> files), and `bun test src` (1984 pass, 0 fail). Full e2e suite intentionally not run this
> pass (unrelated to `e2e/`, slow). Committed as `53482eb`.
