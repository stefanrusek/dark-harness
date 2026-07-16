---
spile: ticket
id: DH-0094
type: feature
status: ready
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

# DH-0094: Agent has no self-awareness of its own dh build, current model, or other available models

## Summary

Live testing: asked the agent about /model, and it could only vaguely guess ('running as the configured default model... no introspective access to a specific version string'). The system prompt tells the model nothing concrete about: what dh build/version it's running under, which model config name/alias it's currently running as, what other models are configured and available in dh.json, or other basic self-facts a real Claude Code instance would know (e.g. via its own system prompt's model-ID table, similar to what this very session's own system prompt provides). Fix: either inject this into the system prompt at agent-loop-start (build info, current model name/config, list of other configured model names), or expose it as a callable tool (or both) so the agent can answer these questions accurately instead of guessing.

## User Stories

### As an agent asked about myself, I want to answer accurately instead of guessing

- Given a user asks the agent what model/build it's running, when it answers, then it states
  concrete facts (dh version/build sha, the model config name/alias it's running as, the
  underlying provider model id) instead of vague hedging.
- Given a user asks what other models are available, when it answers, then it lists the
  other model names configured in `dh.json`, the way this very session's own system prompt
  tells it about sibling model tiers (Opus/Sonnet/Haiku/Fable).

## Functional Requirements

- **Scope decision (owner-adjacent, coordinator call): inject into the system prompt at
  agent-loop-start**, not a separate tool — this is static-per-session info (build/model/
  config), not something that changes mid-turn, so a tool round-trip adds no value real
  system-prompt injection doesn't already give more cheaply. Precedent: `BUILD_INFO`
  (`src/config/build-info.ts`) already exists and is used elsewhere (log headers, `--version`)
  — reuse it here rather than inventing a second build-identity source.
- Add a section to `src/prompt/system-prompt.ts`'s `REQUIRED_CONTRACT` (or `BASE_PROMPT`,
  implementer's call) stating: dh version + git sha (from `BUILD_INFO`), the current agent's
  model config name and underlying provider model id, and the full list of other model names
  configured in `dh.json` (from `config.models`).
- This needs to be threaded per-agent at loop start (Core, `src/agent/loop.ts`/`runtime.ts`)
  since a sub-agent may run a different model than its parent.

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner during live testing — asked the agent about `/model`
> switching and it could only vaguely guess at its own identity. Scope decided directly
> (system-prompt injection, reusing existing `BUILD_INFO`) rather than routed to the
> architect — low ambiguity, no contracts change.
