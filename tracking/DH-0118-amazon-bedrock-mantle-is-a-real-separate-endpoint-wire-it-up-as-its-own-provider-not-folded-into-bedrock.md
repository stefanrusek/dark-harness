---
spile: ticket
id: DH-0118
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0107, DH-0119]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0118: Amazon Bedrock Mantle is a real, separate endpoint -- wire it up as its own provider, not folded into bedrock

## Summary

Deep research (2026-07-17) confirmed Amazon Bedrock Mantle ("Project Mantle") is real and well-documented: a separate distributed inference engine behind a distinct endpoint (bedrock-mantle.<region>.api.aws, own quota pool, Bedrock API-key auth not SigV4), speaking OpenAI Responses API, OpenAI Chat Completions API, and Anthropic Messages API. It is NOT a routing mode of the existing bedrock-runtime path, and it does NOT cover all legacy Bedrock models -- multiple sources indicate it covers primarily open-weight/third-party models (Gemma, gpt-oss, Mistral, DeepSeek, Qwen, Grok) and excludes Claude/Nova/Llama. Same-day fix implemented: dh.json's scaffold (SAMPLE_DH_JSON in src/cli.ts) and the operator's live dh.json now include a "mantle" provider entry (type: openai-compatible, reusing DH-0107's adapter, baseURL https://bedrock-mantle.$(AWS_REGION).api.aws/v1, apiKey $(BEDROCK_MANTLE_API_KEY)), and gemma4's model entry now routes through it instead of the standard bedrock provider. Live-tested against the real endpoint: pending (needs a real BEDROCK_MANTLE_API_KEY).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Live-tested 2026-07-17 via `dh doctor` with a real `BEDROCK_MANTLE_API_KEY`: the plumbing
> works correctly end-to-end -- a real HTTPS request reached the real `bedrock-mantle`
> endpoint and a real, structured JSON error was captured and surfaced by `dh doctor`:
> `HTTP 401: {"error":{"code":"access_denied","message":"Berm is not enabled for this
> account","param":null,"type":"permission_denied_error"}}`. This confirms the
> `openai-compatible` adapter, the `mantle` provider config, and the endpoint URL shape are
> all correct -- the remaining blocker is AWS-side account enablement (the operator's account
> does not have Mantle access granted), not a code issue. Notably the error message says
> "Berm" rather than "Mantle" -- possibly an internal/legacy service name lagging the
> customer-facing branding, worth mentioning if requesting access from AWS Support since
> their tooling may only recognize one name. No further code action needed until Mantle
> access is granted on the account; then re-run `dh doctor` to confirm gemma4 actually works
> end-to-end (connectivity + tool-use).

> [!NOTE]
> **Superseded by DH-0119.** The owner correctly pushed back on the "Berm is not enabled"
> conclusion above being final -- with a real filled-in `BEDROCK_MANTLE_API_KEY`, extensive
> further live testing (including a working sample the owner provided directly, and a real
> `GET /v1/models` catalog listing confirming Mantle recognizes `google.gemma-4-31b`) showed
> this ticket's `openai-compatible`-adapter wiring was correct in shape, but two details were
> wrong: (1) auth is bearer apiKey (this part was right), and (2) Mantle has *two*
> model-vendor-routed surfaces (`/anthropic` for Claude, `/v1` for everything else), not one
> universal one, requiring a second `mantle-anthropic` provider entry this ticket never
> added. DH-0119 has the corrected, live-verified design and is the one to read.
