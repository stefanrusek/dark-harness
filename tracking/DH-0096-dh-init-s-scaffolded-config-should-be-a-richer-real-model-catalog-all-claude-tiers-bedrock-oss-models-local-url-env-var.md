---
spile: ticket
id: DH-0096
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0090]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0096: dh init's scaffolded config should be a richer, real model catalog (all Claude tiers, Bedrock OSS models, local URL env var)

## Summary

Follow-up to DH-0090 (which added `apiKey`/`region` placeholders but kept the same minimal
2-model sample): the owner wants `dh init` to scaffold a much richer, real, working model
catalog covering both major providers and a range of tiers, not just one Anthropic model and
one placeholder Bedrock entry.

## User Stories

### As a first-time operator, I want dh init to scaffold a real, working, comprehensive model catalog

- Given `dh init` scaffolds a config, when the `models`/`provider` arrays are written, then
  all four Claude tiers — Fable, Opus, Sonnet, Haiku — are present, each correctly
  configured for **both** the `anthropic` provider (real model ids, e.g.
  `claude-sonnet-5`) and the `bedrock` provider (real Bedrock model/inference-profile ids
  for the same tiers) — not just one provider per tier.
- Given the default model, when scaffolded, then it's a **working** `gemma4` config on
  Bedrock with a real, correct Bedrock model/inference-profile id (not a placeholder string
  that will 404 the way DH-0092's `sonnet-5` bug did).
- Given Bedrock also hosts non-Anthropic models, when the catalog is scaffolded, then it
  includes a few OpenAI models available on Bedrock, and a few popular open-weight models on
  Bedrock (e.g. Llama, Mistral family) — "a few of each," not exhaustive.
- Given the `local` provider entry (LM Studio-style), when scaffolded, then its `baseURL`
  uses `$(LOCAL_AI_PROVIDER)` as an env-var interpolation placeholder instead of the current
  hardcoded `http://localhost:8080`.

## Functional Requirements

- Every model id in the scaffold must be **real and correct** — verify against the actual
  provider APIs before hardcoding (the DH-0092 incident — a plausible-looking but wrong
  `sonnet-5` model id silently 404ing every request — is exactly the failure mode to avoid
  repeating here, at larger scale, across many more model entries). This repo's own
  `secrets.env` has live AWS credentials available; use the real Bedrock
  `ListFoundationModels`/`ListInferenceProfiles` API (or equivalent) to confirm exact model
  IDs for Claude tiers, OpenAI models, and open-weight models actually available on Bedrock,
  rather than guessing from memory.
- `src/cli.ts`'s `SAMPLE_DH_JSON` and README's copy both need updating in sync (same
  discipline as DH-0090/DH-0092).
- Given the catalog is now much larger, consider whether the scaffold should note in a
  comment-equivalent (JSON has no comments — maybe the `dh init` stdout message, or a
  README callout) that most of these models are provided as a menu/reference and the
  operator should trim to what they actually plan to use, so `dh doctor` isn't testing a
  dozen models' worth of credentials by default.

## Risks

- Bedrock model/inference-profile ids are region-specific and change over time — verify
  against a specific, documented region assumption (e.g. `us-west-2`) and note that clearly,
  since a scaffold that's correct for one region may 404 in another.

## Notes

> [!NOTE]
> Filed 2026-07-16, directly following DH-0092 (the scaffolded-model-id-404 bug) — the owner
> wants the fuller catalog specifically because the current minimal 2-model sample already
> proved fragile once. Empirical verification against live Bedrock is not optional here per
> the ticket's own Functional Requirements — this is exactly the kind of ticket that
> should get root-caused by testing, not guessed at, following this session's established
> discipline (DH-0069 onward).
