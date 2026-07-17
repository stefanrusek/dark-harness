---
spile: ticket
id: DH-0119
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0118]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0119: Real Bedrock Mantle integration, live-verified: mantle-anthropic + mantle-openai

## Summary

Supersedes DH-0118 (which guessed a bespoke SigV4-signed adapter). Live-tested extensively 2026-07-17 with a real BEDROCK_MANTLE_API_KEY: Mantle is bearer-apiKey authenticated (SigV4 also works but is unnecessary -- both hit identical results), with two model-vendor-routed API surfaces reachable via the EXISTING anthropic and openai-compatible provider types, no new adapter code needed: mantle-anthropic (baseURL https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic, Anthropic Messages shape) live-verified working end-to-end (haiku-mantle model passes dh doctor and returns real completions). mantle-openai (baseURL .../v1, Chat Completions shape) is correctly wired and Mantle's own model catalog (GET /v1/models) confirms it recognizes google.gemma-4-31b -- but every live call returns 401 access_denied "Berm is not enabled for this account", a separate AWS-side entitlement gate on top of base Mantle access (confirmed independent of auth mechanism: both bearer apiKey and SigV4 hit the identical gate). Not a code bug -- gemma4 will start working the moment that entitlement is granted on the account.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
