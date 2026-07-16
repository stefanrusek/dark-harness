---
spile: ticket
id: DH-0106
type: bug
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

# DH-0106: gemma4 (Bedrock default model) hallucinates tool calls instead of making them

## Summary

google.gemma-3-12b-it via Bedrock -- dh init's scaffolded defaultModel -- does not reliably make real tool calls. Live-tested session (.dh-logs/d2ab3344-...) shows the model responding to 'create 4 sub agents that each write a poem' with prose plus a fake fenced tool_code block (Agent("agent-1", ...) syntax) instead of ever emitting a real tool_use content block -- confirmed by zero tool_call/tool_result JSONL events in the whole session. When directly told 'did you actually use the calls or just tell me you would', the model apologized and repeated the identical fake-tool-call pattern, still never invoking a real tool. The Bedrock provider adapter (src/agent/providers/bedrock.ts) correctly sends toolConfig via the Converse API -- this is a model capability/reliability gap, not an adapter bug. DH-0096's own live verification only smoke-tested that the model responds to a Converse call, never that it can actually perform agentic tool use, which is a materially different and far more important bar for a harness whose entire premise is tool use. Silent and dangerous: the harness has no detection for 'assistant claimed a tool call in its text but no toolUse block was actually present in the response' -- an operator has to notice by reading the transcript carefully, exactly as the owner just did.

## User Stories

### As a first-time operator running `dh` out of the box, I want the default model to actually do agentic tool use

- Given `dh init`'s scaffolded config (`options.defaultModel: "gemma4"`), when the root agent
  is asked to do anything requiring tool use (spawn sub-agents, read/write files, run
  commands), then it either actually performs the tool calls or fails/reports clearly — never
  silently substitutes prose describing a fake tool call.
- Given the operator directly confronts the model about not having called a tool, then the
  harness itself (not just the model's own text) should be able to confirm/deny whether a
  real tool call happened, rather than relying on the model's own (unreliable) self-report.

## Functional Requirements

- **Verify, live, whether `google.gemma-3-12b-it` via Bedrock Converse supports genuine
  tool-calling at all**, and if so how reliably — this needs real testing against the actual
  Bedrock endpoint (not assumed from docs), since AWS's Converse API is supposed to normalize
  tool use across models but not every hosted model actually implements it. Check AWS's own
  Bedrock model-capability documentation for `google.gemma-3-12b-it` specifically (tool
  use / function calling support flag) as a starting point, then confirm empirically.
- **If unsupported or unreliable**: `gemma4` must not remain `dh init`'s scaffolded
  `options.defaultModel` — a first-run default that silently fails at the harness's core
  premise (tool use) is worse than no default. Owner should decide the replacement (a
  Claude-tier model already confirmed reliable this session is the safe fallback candidate,
  e.g. `haiku-bedrock` or `haiku-anthropic` for cost, or keep a Claude tier as default and
  keep `gemma4` in the menu as an explicitly "no tool-calling / chat-only" labeled entry).
- **Consider a harness-level capability probe** (possibly folded into `dh doctor`): a
  cheap real request that includes a trivial no-op tool and checks whether the model's
  response actually contains a `tool_use`/`toolUse` content block, distinct from the existing
  connectivity-only check. This would let `dh doctor` flag "connects, but doesn't support
  tool use" as a distinct result from plain PASS, for any model an operator configures — not
  just gemma4 — since this is a general Bedrock-model-menu risk (the OpenAI/open-weight
  entries DH-0096 added may have the same gap, untested for this specific failure mode).
- Whatever the fix, re-verify live against the real Bedrock API (per this session's
  established discipline) before closing — this is exactly the class of finding a scaffolded
  config can get wrong silently (see DH-0092's precedent: a plausible-looking but broken
  default).

## Assumptions

- The Bedrock provider adapter itself (`src/agent/providers/bedrock.ts`) is not at fault —
  confirmed it correctly builds and sends `toolConfig` via `ConverseCommand`. This is a model
  capability/reliability issue, not a wire-format bug.
- Scope is the *default model choice and any detection gap*, not a demand that every
  Bedrock/open-weight model in DH-0096's menu support tool use — some may be legitimately
  chat-only, but if so they should be labeled as such, not risk being the default.

## Risks

- If `google.gemma-3-12b-it` turns out to support tool use only under a different request
  shape (e.g. requires a specific system-prompt convention many open-weight models need to
  reliably emit function calls), the fix might be a prompting change rather than a default-
  model swap — verify before assuming the model is simply incapable.
- A capability probe added to `dh doctor` adds a second real API call per model (cost/latency
  during `dh doctor`) — worth it for correctness, but note the tradeoff explicitly if pursued.

## Open Questions

- Should the default model change, or should `dh doctor`/`dh init` instead print an explicit
  warning next to any model known/found not to support tool use? Either could be right —
  this is an owner call, not an implementer one, given it changes the shipped first-run
  experience.

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner during live testing: asked gemma4 to spawn 4 sub-agents, it
> replied with a plan plus a fake fenced `` ```tool_code` `` block containing
> `Agent("agent-1", "...")`-style pseudo-calls — no real `tool_use` content block, confirmed
> by zero `tool_call`/`tool_result` events in `.dh-logs/d2ab3344-0b64-4905-821c-636ba49eb744/
> agent-root.jsonl`. When told directly "did you actually use the calls or just tell me you
> would," the model apologized and repeated the identical fake pattern verbatim, still never
> making a real call. Session ended `stopped` with zero sub-agents ever spawned.
