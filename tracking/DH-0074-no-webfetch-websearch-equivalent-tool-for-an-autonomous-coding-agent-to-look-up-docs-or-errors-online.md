---
spile: ticket
id: DH-0074
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
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

**Owner decision (2026-07-16): four distinct user stories, not one bundled story — WebFetch
and WebSearch are separate tools with separate opt-in settings, both defaulting off. The
architect should design the exact settings shape.**

### As an agent debugging an unfamiliar error or looking up a specific URL, I want to fetch a page's content

- Given WebFetch is enabled, when the agent calls it with a URL (and optionally a prompt
  describing what to extract), then it returns processed page content, mirroring real
  Claude Code's WebFetch shape.

### As an agent needing to search the web for current information, I want a WebSearch tool

- Given WebSearch is enabled, when the agent calls it with a query, then it returns search
  results, mirroring real Claude Code's WebSearch shape.

### As an operator, I want a setting to enable/disable WebFetch, defaulting off

- Given `dh.json`, when a WebFetch-enabling setting is set, then the tool is registered;
  when unset, the tool is absent entirely (not registered-but-erroring) — default is off,
  consistent with the air-gapped-by-default posture (ADR 0003).

### As an operator, I want a separate setting to enable/disable WebSearch, defaulting off

- Given `dh.json`, when a WebSearch-enabling setting is set, then the tool is registered;
  when unset, absent entirely. Independent of the WebFetch setting — an operator may want
  one without the other (e.g. WebFetch for a specific allowed URL, no open-ended search).

## Functional Requirements

- New tools: `src/agent/tools/web-fetch.ts` and `src/agent/tools/web-search.ts`, mirroring
  real Claude Code's WebFetch (URL + prompt, returns processed content) and WebSearch
  (query, returns results) schemas.
- Two independent `dh.json` opt-in settings (exact field names/shape left to the architect
  design pass) — neither tool is unconditionally registered in `ALL_TOOLS`, given the
  project's air-gapped-by-default security posture (ADR 0003, Constitution §4.3). This
  needs architect (Fable) review per Constitution §6.4 ("anything touching the security
  posture") — routed there.
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
