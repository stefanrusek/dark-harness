# AWS Support case draft — Bedrock Mantle "Berm" entitlement

**Service:** Amazon Bedrock
**Category:** Bedrock Mantle / model access
**Severity:** General guidance (not production-impacting)

## Subject

Request to enable third-party model access ("Berm") for Amazon Bedrock Mantle Chat
Completions API

## Body

We have working access to Amazon Bedrock Mantle's Anthropic Messages API surface
(`https://bedrock-mantle.<region>.api.aws/anthropic`) — confirmed via a successful live
call to `anthropic.claude-haiku-4-5`.

We're trying to reach third-party/open-weight models (specifically `google.gemma-4-31b`,
confirmed present in our account's model catalog via `GET https://bedrock-mantle.<region>
.api.aws/v1/models`) via Mantle's Chat Completions API surface
(`https://bedrock-mantle.<region>.api.aws/v1/chat/completions`).

Every request to that surface — using either a Bedrock API key (bearer auth) or SigV4
credentials, both otherwise valid and working for the Anthropic surface — returns:

```
HTTP 401
{"error":{"code":"access_denied","message":"Berm is not enabled for this account","param":null,"type":"permission_denied_error"}}
```

Could you confirm:
1. What "Berm" refers to as an account-level entitlement (it doesn't appear in Mantle's
   public-facing documentation, which uses "Mantle" — is this an internal/legacy name for
   the same feature, or something distinct?).
2. How to request/enable it for our account.

Region: us-east-1. Account ID: [FILL IN].

## Notes for whoever files this

- Fill in the AWS Account ID before submitting.
- "Berm" is not a documented public term — AWS support may not immediately recognize it by
  that name alone; the message above gives both the literal error text and enough context
  (Mantle, Chat Completions, third-party models) to triage even if "Berm" itself isn't a
  name their tooling surfaces.
