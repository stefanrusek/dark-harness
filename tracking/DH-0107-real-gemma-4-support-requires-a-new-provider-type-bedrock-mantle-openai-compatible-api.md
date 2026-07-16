---
spile: ticket
id: DH-0107
type: feature
status: draft
owner: stefan
resolution:
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

- **Architect design needed first** (this ticket is `draft`, not `ready`, for exactly this
  reason): a new `ProviderType` value in `src/contracts/config.ts` (currently `"anthropic" |
  "bedrock"`) is a shared wire-truth change per CLAUDE.md §3/§6 — needs Fable's sign-off
  before Core builds against it, same process as DH-0093's contracts round.
- New provider adapter (parallel to `src/agent/providers/anthropic.ts`/`bedrock.ts`) speaking
  the OpenAI-compatible Chat Completions or Responses API against
  `https://bedrock-mantle.{region}.api.aws/openai/v1`.
- New credential shape: a Bedrock long-term API key (bearer token), generated via the AWS
  Bedrock console — distinct from the existing SigV4 `AWS_ACCESS_KEY_ID`/
  `AWS_SECRET_ACCESS_KEY` flow the `"bedrock"` provider type uses. `dh.json`'s
  `ProviderConfig` schema needs a field for this (extend-minimally per ADR 0006).
  `$(VAR)`-style interpolation should work the same way as existing `apiKey`/`region` fields.
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

- Chat Completions vs. Responses API — which does this project's agent-loop abstraction map
  onto more naturally? Architect call.
- Should this become a third generic `ProviderType` ("openai-compatible") usable for any
  OpenAI-compatible endpoint (LM Studio already piggybacks on the `"anthropic"` type via
  `baseURL` override per the existing scaffold — is that still adequate, or does this new
  provider type generalize better)? Worth deciding once, since a future OpenAI-hosted model
  or another OpenAI-compatible vendor would otherwise prompt the same question again.

## Notes

> [!NOTE]
> Split out from DH-0106 (2026-07-16): the owner's original DH-0096 ask was for a working
> Gemma 4 config, but DH-0096's implementation silently substituted Gemma 3 (reachable via
> the standard Bedrock Converse API) because real Gemma 4 isn't reachable that way at all —
> confirmed via live investigation (DNS + a real `405 Method Not Allowed` response from
> `bedrock-mantle.us-east-1.api.aws`, matching AWS's documented API contract exactly).
> Routing to Fable for architect design given the `src/contracts/` touch, per CLAUDE.md §6.
