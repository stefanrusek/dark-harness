---
spile: ticket
id: DH-0040
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0040: Bash tool's full-environment inheritance and unredacted provider error messages are undocumented secrets-exposure vectors

## Summary

The Bash tool (`src/agent/tools/bash.ts`) spawns `bash -c <command>` with no explicit `env`, so it
inherits the full harness process environment — including any provider API key or `DH_TOKEN`
referenced via `$(VAR)` in `dh.json`. Given the project's "everything is allowed, always"
permission model, this is inherent to the design, but it is nowhere documented as an explicit
residual risk: a malicious/compromised repo (e.g. a poisoned README the agent reads) can direct
Bash to read `process.env` and exfiltrate the harness's own provider credentials over the network
in a non-air-gapped deployment — the mitigation (air-gapping) is real but the specific risk it
mitigates is never spelled out for operators deciding whether air-gapping is worth the operational
cost. Separately, both provider adapters wrap raw SDK error messages into `ProviderError` with no
redaction pass — if any SDK version ever echoes partial key/header material in an error body (not
confirmed either way for the current SDKs), it would flow unredacted into agent context and the
JSONL log.

## User Stories

### As an operator deciding on air-gapping, I want the README/ADR to state plainly what a non-air-gapped run risks

- Given the "everything is allowed" permission model, when reading the security posture docs, then
  a specific sentence states that a non-air-gapped run reading attacker-controlled content can
  exfiltrate the harness's own environment (including provider credentials) via Bash.

### As a maintainer, I want provider error messages to be redacted defensively before reaching logs/context

- Given any provider SDK error, when it's wrapped into `ProviderError`, then a redaction pass strips
  common secret-shaped substrings (e.g. `sk-ant-...`) as defense-in-depth, regardless of whether the
  current SDK is confirmed to leak them.

## Notes

> [!NOTE]
> Source: Security audit findings #12, #13, #18 (this is documentation + defensive redaction, not
> a design change to the permission model — the permission model itself is a locked ADR and is not
> being relitigated here). Overlaps with Server sweep finding #8 (logger has no redaction
> awareness) tracked in **DH-0020** — this ticket covers the Bash/provider-error-message side of the
> same secrets-hygiene theme, and the README/ADR documentation gap specifically.
