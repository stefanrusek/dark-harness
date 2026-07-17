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

> [!NOTE]
> **Root cause found, fully resolved 2026-07-17.** "Berm is not enabled for this account"
> is NOT an account-level entitlement gate at all -- it's a misleading error Mantle returns
> when a model that requires the `/openai`-prefixed path (`/openai/v1/chat/completions`)
> is routed to the unprefixed path (`/v1/chat/completions`) instead. Found via a third-party
> gateway's docs (truefoundry.com) documenting this exact routing quirk and explicitly
> listing `google.gemma-4-31b` as one of the affected models (alongside `google.gemma-4-e2b`,
> `google.gemma-4-26b-a4b`, `openai.gpt-5.5`, `openai.gpt-5.4`, `xai.grok-4.3`). Confirmed
> live: the identical request against `/openai/v1/chat/completions` returns `200` with a
> real completion. `mantle-openai`'s `baseURL` fixed to
> `https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1`.
>
> **Both `haiku-mantle` and `gemma4` are now fully live-verified working end to end via
> `dh doctor`** -- `gemma4` shows a plain `PASS` (not `PASS (no tool-use)`), meaning it
> passed the tool-use probe too. This is the first real evidence on real Gemma 4 behavior
> this project has had (DH-0106's original tool-use claim was based on untested gemma3
> assumptions) -- Gemma 4 via Mantle does make real tool calls.
>
> Known limitation carried forward, not yet handled generically: which models need the
> `/openai` prefix isn't derivable from the model catalog itself (per the same third-party
> docs) -- `mantle-openai`'s baseURL is hardcoded to always use the prefix, which happens to
> be correct for every model currently in this config's `mantle-openai` slot, but would be
> wrong if a future model needing the *unprefixed* path were added to the same provider
> entry. Not worth generalizing until that actually happens.
