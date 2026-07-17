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
  relates_to: [DH-0107]
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
