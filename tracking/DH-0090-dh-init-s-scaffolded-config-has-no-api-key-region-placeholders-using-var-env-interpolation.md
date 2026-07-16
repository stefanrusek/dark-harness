---
spile: ticket
id: DH-0090
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

# DH-0090: dh init's scaffolded config has no API-key/region placeholders using $(VAR) env interpolation

## Summary

Motivated directly by losing an untracked dh.json this session with no backup: SAMPLE_DH_JSON (src/cli.ts) currently scaffolds a config with no apiKey or region fields at all for the anthropic/bedrock providers, even though ProviderConfig (src/contracts/config.ts) supports both. A first-time operator running dh init gets a config that will not actually authenticate against a real provider without manually discovering and adding these fields from README docs. Fix: prepopulate the scaffolded anthropic and bedrock provider entries with apiKey/region fields using $(VAR) env-var interpolation placeholders (e.g. apiKey: "$(ANTHROPIC_API_KEY)", region: "$(AWS_REGION)"), matching the config schema's existing $(VAR) interpolation support, so dh init produces something closer to actually-usable out of the box.

## User Stories

### As a first-time operator running `dh init`, I want the scaffolded config to already have the right shape for real credentials

- Given `dh init` scaffolds a config, when the anthropic provider entry is written, then it
  includes `apiKey: "$(ANTHROPIC_API_KEY)"` (matching the existing `$(VAR)` interpolation
  support), not just `{ name, type }` with no credential field at all.
- Given the same for the bedrock provider entry, then it includes `region: "$(AWS_REGION)"`
  (and any other commonly-needed Bedrock field — e.g. explicit `apiKey`/`secretAccessKey` if
  dh's Bedrock adapter supports credential overrides beyond the default AWS credential
  chain, check `src/agent/providers/bedrock.ts`/`ProviderConfig` for what's actually
  supported).

## Functional Requirements

- `src/cli.ts`'s `SAMPLE_DH_JSON`: add the placeholder fields to the `anthropic` and
  `bedrock` provider entries.
- Keep the `local` provider entry (LM Studio-style, no credentials needed) as-is.
- Update README's own copy of the sample config to match (the existing
  `readme-config-sync.test.ts` gate should catch drift, but confirm this specific change
  doesn't need a separate manual README edit beyond what that test enforces).

## Notes

> [!NOTE]
> Filed 2026-07-16, motivated directly by losing an untracked `dh.json` this session with no
> backup and no easy way to reconstruct it from a bare `dh init` scaffold.
