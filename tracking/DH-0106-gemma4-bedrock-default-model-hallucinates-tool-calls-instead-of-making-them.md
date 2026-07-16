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

# DH-0106: dh init's scaffolded "gemma4" is actually Gemma 3 (wrong model), and hallucinates tool calls

## Summary

**Root cause, confirmed 2026-07-16 by live investigation**: DH-0096's owner-requested "a
working gemma4 bedrock config (the default)" meant real **Gemma 4** — but the model actually
scaffolded as `dh init`'s `defaultModel` (`"gemma4": { provider: "bedrock", model:
"google.gemma-3-12b-it" }`) is **Gemma 3**, a different model entirely. This was not a naming
quirk: Gemma 4 (real, released by Google starting 2026-03-31, on Bedrock since 2026-06-10) is
**not reachable via the standard Bedrock on-demand catalog or the Converse/Invoke APIs at
all** — it's served only through a distinct AWS product/endpoint called **`bedrock-mantle`**
(`https://bedrock-mantle.{region}.api.aws/openai/v1`), an OpenAI-compatible Chat
Completions/Responses API authenticated with a **Bedrock long-term API key** (a bearer
token), not the SigV4 credentials `dh`'s existing `"bedrock"` provider type uses. DH-0096's
implementing agent apparently could not find a route to real Gemma 4 through the tooling it
had (Bedrock's standard `ListFoundationModels`/Converse APIs, which never surface Gemma 4)
and silently substituted the nearest same-vendor model (Gemma 3) without flagging the
substitution — a real instance of exactly the DH-0092/DH-0106-class failure this project has
hit before: a scaffolded default that looks plausible but is quietly wrong.

**Separately, and regardless of which Gemma generation**: the Gemma 3 model that did get
shipped does not reliably make real tool calls. Live-tested session
(`.dh-logs/d2ab3344-.../agent-root.jsonl`) shows it responding to "create 4 sub agents that
each write a poem" with prose plus a fake fenced `tool_code` block (`Agent("agent-1", ...)`
pseudo-syntax) instead of ever emitting a real `tool_use` content block — confirmed by zero
`tool_call`/`tool_result` JSONL events in the whole session. When told directly "did you
actually use the calls or just tell me you would," the model apologized and repeated the
identical fake pattern, still never invoking a real tool. The Bedrock provider adapter
(`src/agent/providers/bedrock.ts`) correctly sends `toolConfig` via the Converse API — this
is a model capability/reliability gap, not an adapter bug.

Real Gemma 4 (per its AWS model card) explicitly supports "native function calling" designed
for agentic workflows — a materially different, and likely reliable, capability compared to
Gemma 3's observed hallucinated-tool-call behavior (with one caveat: Gemma 4's model card
states parallel tool calls are *not* supported — one call per turn only).

**This ticket now covers**: (1) fixing the immediate, safe-to-dispatch problem — `dh init`'s
default should not be a model that hallucinates tool calls; (2) documenting that real Gemma 4
support is a separate, bigger feature requiring a new provider type. **Real Gemma 4 support
itself is split out to DH-0107** (new provider type = `src/contracts/` change, needs
architect sign-off per CLAUDE.md §6 — not in scope here).

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

- **Owner decision (2026-07-16): swap the default.** `dh init`'s `options.defaultModel` moves
  off `gemma4`/Gemma 3 to a Claude tier already confirmed reliable this session (e.g.
  `haiku-bedrock` or `haiku-anthropic` for cost) — a first-run default that silently
  hallucinates tool calls is worse than no default.
- The `gemma4` model entry can stay in the scaffolded model *menu* (it's a legitimate, real,
  connectable model — `dh doctor` PASSes it), but must not be `options.defaultModel`, and
  should be labeled/commented in the scaffold as chat-only / unreliable-for-agentic-tool-use
  so an operator who deliberately picks it isn't surprised.
- Also **add a harness-level capability probe** to `dh doctor`: alongside its existing
  connectivity-only check, send one real request per model that includes a trivial no-op tool
  and confirm the response actually contains a real `tool_use`/`toolUse` content block (not
  just a 200 response). Flag any model that connects but never emits a real tool-use block as
  a distinct result from plain PASS (e.g. `PASS (no tool-use)` or similar — exact wording is
  an implementer call) — this generalizes past just gemma4/Gemma 3, since the other Bedrock
  open-weight/OpenAI entries DH-0096 added are untested for this same failure mode.
- Re-verify live against the real Bedrock API (per this session's established discipline)
  before closing — this is exactly the class of finding a scaffolded config can get wrong
  silently (see DH-0092's precedent: a plausible-looking but broken default).

## Assumptions

- The Bedrock provider adapter itself (`src/agent/providers/bedrock.ts`) is not at fault —
  confirmed it correctly builds and sends `toolConfig` via `ConverseCommand`. This is a model
  capability/reliability issue, not a wire-format bug.
- Real Gemma 4 support (a new provider type against `bedrock-mantle`) is explicitly out of
  scope here — tracked separately as DH-0107.
- Scope is the default model choice plus a general doctor capability probe, not a demand that
  every Bedrock/open-weight model in DH-0096's menu support tool use — some may be legitimately
  chat-only, but if so they should be labeled as such, not risk being the default.

## Risks

- If `google.gemma-3-12b-it` turns out to support tool use only under a different request
  shape (e.g. requires a specific system-prompt convention many open-weight models need to
  reliably emit function calls), the fix might be a prompting change rather than a default-
  model swap — verify before assuming the model is simply incapable.
- A capability probe added to `dh doctor` adds a second real API call per model (cost/latency
  during `dh doctor`) — worth it for correctness, but note the tradeoff explicitly if pursued.

## Open Questions

(resolved 2026-07-16 — owner decision: swap the default per Functional Requirements above.)

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner during live testing: asked gemma4 to spawn 4 sub-agents, it
> replied with a plan plus a fake fenced `` ```tool_code` `` block containing
> `Agent("agent-1", "...")`-style pseudo-calls — no real `tool_use` content block, confirmed
> by zero `tool_call`/`tool_result` events in `.dh-logs/d2ab3344-0b64-4905-821c-636ba49eb744/
> agent-root.jsonl`. When told directly "did you actually use the calls or just tell me you
> would," the model apologized and repeated the identical fake pattern verbatim, still never
> making a real call. Session ended `stopped` with zero sub-agents ever spawned.

> [!NOTE]
> Follow-up investigation (2026-07-16) found the deeper root cause: the owner's original
> DH-0096 request was for real **Gemma 4**, not Gemma 3. Real Gemma 4 is confirmed to exist
> (Google, released starting 2026-03-31) and confirmed live on AWS Bedrock (since
> 2026-06-10) — but *only* through a separate product/endpoint, `bedrock-mantle`
> (`https://bedrock-mantle.{region}.api.aws/openai/v1`, OpenAI-compatible Chat
> Completions/Responses API, authenticated via a Bedrock long-term API key, not SigV4).
> `dh`'s standard Bedrock `ListFoundationModels`/Converse path never surfaces Gemma 4 at all,
> which is presumably why DH-0096's implementing agent silently substituted Gemma 3 instead
> of flagging that it couldn't find real Gemma 4 through the tooling it had. Empirically
> confirmed live: `bedrock-mantle.us-east-1.api.aws` resolves to real AWS IPs and returns a
> correctly-shaped `405 Method Not Allowed` (`Allow: POST,OPTIONS`) on the documented chat-
> completions path. Real Gemma 4 support is tracked separately as **DH-0107** (new provider
> type, contracts-level change, needs architect sign-off) — this ticket's scope is narrowed
> to the immediate default-model fix plus a general `dh doctor` tool-use capability probe.
