---
spile: ticket
id: DH-0074
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0074: No WebFetch/WebSearch-equivalent tool for an autonomous coding agent to look up docs or errors online

## Summary

Real Claude Code ships WebFetch and WebSearch tools letting an agent fetch a URL's content or run a web search -- useful for a coding agent looking up library docs, API references, or error messages. dh has no equivalent in src/agent/tools/. This is a genuine capability gap for dh's stated coding-agent use case, though it interacts with the project's air-gapped-by-default security posture (docs/adr/0003-security-posture.md) -- likely wants to be opt-in via dh.json rather than always-on, which is why this is filed as draft rather than ready.

## User Stories

### As an agent debugging an unfamiliar error or API, I want to fetch documentation or search the web

- Given an agent hits an error message it doesn't recognize, when it has WebFetch/WebSearch
  available, then it can look up the error or the relevant library's docs instead of
  guessing from training-data knowledge alone.
- Given an operator running dh air-gapped (the default posture per ADR 0003), when
  WebFetch/WebSearch is not configured, then the tools are either absent or fail with a
  clear, expected error -- never a silent hang or a surprising network call.

## Functional Requirements

- New tools: `src/agent/tools/web-fetch.ts` and/or `src/agent/tools/web-search.ts`, mirroring
  real Claude Code's WebFetch (URL + prompt, returns processed content) and WebSearch
  (query, returns results) schemas.
- Gate behind explicit `dh.json` opt-in (e.g. under `options` or a new config key) rather
  than being unconditionally registered in `ALL_TOOLS`, given the project's air-gapped-
  by-default security posture (ADR 0003, Constitution §4.3) -- this likely needs architect
  (Fable) review per Constitution §6.4 ("anything touching the security posture").
  identify: does adding network-egress tools count as a security-posture change requiring
  escalation? Recommend yes, given §6.4's explicit framing.
- Ownership: `src/agent/tools/` is Core domain per Constitution §3.

## Assumptions

- Given the security posture invariant, this is inherently a design/scope judgment call
  (hence `draft`, not `ready`) -- an architect call on whether/how to gate it, not a
  mechanical addition.

## Risks

- Directly in tension with the "air-gapping remains the primary posture" invariant (ADR
  0003) -- needs explicit opt-in design, clear documentation steering operators away from
  enabling it in air-gapped deployments, and probably a loud warning if enabled.
- SSRF-style risks (fetching internal/localhost URLs) if not scoped carefully.

## Open Questions

- Does this need architect (Fable) sign-off before any implementation, per Constitution
  §6.4? (Recommend yes.)
- Is a full WebSearch (requiring a search-API backend) in scope for a self-hosted harness,
  or is WebFetch (URL-only, no search-index dependency) the more realistic v1 scope?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Judgment call: flagged as in-scope
> for a coding-agent harness (unlike DesignSync/RemoteTrigger/PushNotification, which were
> judged out of scope as Anthropic's own product infra) but explicitly gated by the
> existing security-posture invariant.
