# Bedrock Mantle comprehension guide

This is a durable, standalone writeup of the Bedrock Mantle / Gemma 4 work done across
DH-0106, DH-0107, DH-0118, DH-0119, and DH-0120. It exists because this was hard-won,
live-tested knowledge (wrong theories discarded mid-stream, a real wire-protocol bug found
only by hitting a real endpoint) and the owner explicitly does not want it lost or silently
reinvented wrong by a future agent. Written so a fresh agent with zero context on this repo
can pick this up and either extend it correctly or explain it to someone else without
re-deriving any of it from scratch.

**Bottom line up front: this is shipped and working today.** Both Mantle routes
(`mantle-anthropic`, `mantle-openai`) are implemented, configured in the committed `dh.json`,
documented in `docs/CONFIGURATION.md`, and live-verified end-to-end including real tool use.
No new provider adapter code was needed for Mantle itself — it reuses the existing
`anthropic` and `openai-compatible` provider types, pointed at Mantle's URLs. Read on for why
that's true and what almost went wrong along the way.

## 1. What Bedrock Mantle actually is

Bedrock Mantle ("Project Mantle") is a **real, separate AWS distributed-inference endpoint**,
distinct from the standard `bedrock-runtime` path `dh`'s `"bedrock"` provider type already
used. Key facts, confirmed by deep research (DH-0118) and then corrected/refined by real live
testing (DH-0119):

- **Different hostname, different auth, different quota pool.** Mantle is reached at
  `bedrock-mantle.<region>.api.aws`, not the SigV4-signed `bedrock-runtime.<region>
  .amazonaws.com` endpoint the `"bedrock"` provider type calls via the AWS SDK's
  `BedrockRuntimeClient`/`ConverseStreamCommand`. Mantle authenticates with a **Bedrock
  long-term API key** — a plain bearer token generated in the Bedrock console — not the
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` SigV4 credential chain. (DH-0119 confirmed
  SigV4 *also* works against Mantle and hits identical results, but bearer-apiKey is what
  `dh` actually uses — see §4.)
- **It is NOT a routing mode of the existing bedrock-runtime path**, and it does **not**
  cover all Bedrock models. Per DH-0118's research, it covers primarily open-weight/
  third-party model families — Gemma, gpt-oss, Mistral, DeepSeek, Qwen, Grok — and explicitly
  **excludes** Claude/Nova/Llama on the *classic* Bedrock catalog side. (Confusingly, Claude
  models ARE reachable through Mantle too, but via Mantle's own Anthropic-shaped route — see
  next bullet. The exclusion is about the classic ListFoundationModels/Converse catalog, not
  about what Mantle itself can serve.)
- **Two model-vendor-routed API surfaces, not one universal one.** This was the single
  biggest wrong turn in this work (see DH-0118's superseding note) — Mantle isn't one
  generic gateway, it's two:
  - `/anthropic` — speaks the **Anthropic Messages API** shape. Used for Claude models
    reached through Mantle (e.g. `haiku-mantle`).
  - `/v1` and `/openai/v1` — speaks the **OpenAI Chat Completions API** shape. Used for
    Gemma, gpt-oss, and other open-weight models. See §3 for the critical `/openai` prefix
    detail — getting this wrong produces a *misleading* error, not a clean 404.
- **Why it needed its own provider wiring, but NOT its own provider *type*** (DH-0118 §1,
  reasoning later validated/refined by DH-0119): the ticket's original framing treated
  Mantle as a Bedrock variant. That's wrong. `bedrock.ts` is structurally defined by two
  things Mantle does not have: the AWS SDK's `BedrockRuntimeClient`/`ConverseStreamCommand`
  wire shape, and the ambient AWS SigV4 credential chain (`bedrock`-type's validated config
  keys are just `{"region"}` — no `apiKey` field exists on that type at all; see
  `src/config/validate.ts:29-33`). Mantle is a plain HTTPS endpoint with bearer-token auth,
  speaking either the Anthropic Messages shape or the OpenAI Chat Completions shape depending
  on route — categorically the same shape as the *existing* `"anthropic"` and
  `"openai-compatible"` provider types, which already model "any endpoint that speaks this
  wire shape, `baseURL`-pointed." Building a bespoke `bedrock-mantle` adapter (DH-0118's
  first-pass, guessed instinct — including a guess at bespoke SigV4 signing — before real
  testing) would have meant reimplementing machinery that already existed for the wrong
  reason. **Net result: Mantle needed zero new provider-adapter code.** It only needed two
  new `provider[]` *entries* in `dh.json` pointed at the right URLs with the right type.

## 2. Why this was needed: Gemma 4 (DH-0107) and the models it unlocks

The origin was DH-0096 (an owner ask for "a working gemma4 bedrock config"), which
DH-0106 caught: the scaffolded `dh init` default silently substituted **Gemma 3** for real
**Gemma 4**, because Gemma 4 (Google, released 2026-03-31, on Bedrock since 2026-06-10) is
**not reachable at all** through the standard Bedrock `ListFoundationModels`/Converse APIs —
confirmed live by DNS resolving `bedrock-mantle.us-east-1.api.aws` to real AWS infrastructure
and getting a correctly-shaped `405 Method Not Allowed` on the documented chat-completions
path (DH-0106, DH-0107 summaries). Real Gemma 4 support is reachable *only* through Mantle.

DH-0107 designed and shipped the underlying primitive this all depends on: a new
`ProviderType` value **`"openai-compatible"`** (`src/contracts/config.ts`) and a new
`src/agent/providers/openai-compatible.ts` adapter speaking the OpenAI Chat Completions API
over plain `fetch` (no OpenAI SDK dependency). This was explicitly designed as **generic** —
reusable for any OpenAI-Chat-Completions-shaped endpoint (LM Studio, a future vendor, or
Mantle) — not named `"bedrock-mantle"`, precisely so Mantle wouldn't need special-casing
later (DH-0107 Architect Design §2). That generality is exactly what made DH-0118/DH-0119
possible without new adapter code.

**Models verified working end-to-end via Mantle, per DH-0119 and the committed `dh.json`:**

- `haiku-mantle` → `anthropic.claude-haiku-4-5` via `mantle-anthropic` (`/anthropic` route,
  Anthropic Messages shape). Live-verified: `dh doctor` PASS, real completions.
- `gemma4` → `google.gemma-4-31b` via `mantle-openai` (`/openai/v1` route, Chat Completions
  shape). Live-verified: `dh doctor` plain `PASS` **including the tool-use probe** — i.e.
  Gemma 4 via Mantle does make real tool calls (see §5 for why this matters against DH-0106's
  earlier, wrong assumption about Gemma-family tool use).

DH-0119's note also lists other models a third-party gateway's docs (truefoundry.com)
document as needing the same `/openai`-prefixed route as `gemma4`: `google.gemma-4-e2b`,
`google.gemma-4-26b-a4b`, `openai.gpt-5.5`, `openai.gpt-5.4`, `xai.grok-4.3`. **None of these
except `google.gemma-4-31b` have been added to `dh`'s scaffolded config or live-verified by
this project** — they're mentioned in the ticket as third-party-documented context, not as
things `dh` has tested. Do not assume they work without independent verification.

Gemma 4's model card also states it does **not** support parallel tool calls — one call per
turn only. DH-0107's architect design (§5) resolved this as adapter-internal / no-op: the
`ModelProvider.complete()` contract already returns an arbitrary-length `content` array per
turn and the agent loop doesn't assume more than one `tool_use` block; a Gemma-4 turn will
structurally only ever contain at most one because that's what the model itself emits. No
`loop.ts` change was made or is believed necessary.

## 3. The two hard-won bugs

These are the two subtle, wire-protocol-level findings this whole effort turned up. Both are
exactly the kind of detail that's easy to reintroduce if reimplemented from a spec rather
than from this history.

### 3a. DH-0106: "hallucinated" tool calls — a model-capability issue, not an adapter bug

Symptom: asked to spawn 4 sub-agents, the *Gemma 3* model (the wrong-model default DH-0106
was filed to fix) responded with prose plus a fake fenced ` ```tool_code ` block containing
pseudo-syntax like `Agent("agent-1", ...)` — never a real `tool_use` content block. Confirmed
by zero `tool_call`/`tool_result` events in the session's JSONL log. When told directly it
hadn't actually called anything, it apologized and repeated the identical fake pattern.

**Root cause**: this was confirmed to be a **model capability/reliability gap in Gemma 3
itself**, not a `dh` adapter bug — `src/agent/providers/bedrock.ts` was confirmed to
correctly build and send `toolConfig` via `ConverseCommand`. The actual fix was:
`dh init`'s `options.defaultModel` was moved off `gemma4`/Gemma 3 onto a Claude tier
(`haiku-bedrock`), the Gemma 3 entry stayed in the scaffolded model *menu* but not as the
default, and a `dh doctor` tool-use capability probe was added (send a real request with a
trivial no-op tool, confirm a real `tool_use` block comes back — flagging "connects but
never emits a real tool call" as a distinct result, not a plain `PASS`).

**Important later correction**: DH-0119 found real **Gemma 4** (via Mantle) does *not* have
this problem — `dh doctor` gives it a plain `PASS` including the tool-use probe. DH-0106's
finding was specifically about the wrong-model substitute (Gemma 3 via classic Bedrock), not
about the Gemma family generally. Don't conflate the two. As of the current `dh.json` and
`docs/CONFIGURATION.md`, there is a residual inconsistency worth flagging explicitly (see
§6 below): `docs/CONFIGURATION.md:234-238` still describes `gemma4` as "chat-only" /
"reliably hallucinates tool calls," which reflects the DH-0106-era Gemma-3-via-classic-Bedrock
finding, not the corrected DH-0119 Gemma-4-via-Mantle finding that it does pass the tool-use
probe. That prose should probably be updated to reflect the newer, more favorable result —
this guide is not changing `CONFIGURATION.md` itself, just flagging the discrepancy.

### 3b. DH-0120: missing `"type": "function"` on outgoing `tool_calls`

Symptom: live-tested against real Mantle (`gemma4` via `mantle-openai`), the **first** tool
call in a session worked fine, but the **next** turn — where the adapter replays the
assistant's prior `tool_calls` back to the model as conversation history — failed with a real
HTTP 400 from Mantle: `Invalid tool_calls: missing field type`.

**Root cause, precisely**: `toOpenAiMessages()` in `src/agent/providers/openai-compatible.ts`
built the assistant-role replay of a prior tool call as `{ id, function }` with **no `type`
field**. The real OpenAI Chat Completions schema requires `"type": "function"` on every
`tool_calls` entry, not just on the way you request tools be available, but on every
*outgoing* tool-call object you echo back into message history. This is a schema requirement
that OpenAI's own docs specify but that a permissive/lenient endpoint won't necessarily
enforce — which is exactly why it was never caught before Mantle: Mantle validates strictly
and rejected the malformed replay; whatever was tested against previously (unit tests, any
earlier informal check) apparently didn't.

**The fix, and why the bug survived unit tests before this**: `type: "function"` was added
in three places — the `OpenAiChatMessage.tool_calls` type definition and the two call sites
building `tool_calls` objects (the initial request-side tool_calls when there are `tool_use`
blocks in message history, plus the corresponding assistant-message-building code) in
`src/agent/providers/openai-compatible.ts` (see the `tool_calls?: { id: string; type:
"function"; function: {...} }[]` field on `OpenAiChatMessage`, and the `toOpenAiMessages()`
function around line 109-152, specifically the `toolCalls.push({ id: block.id, type:
"function", function: {...} })` construction). The existing unit test
(`openai-compatible.test.ts`) that exercised this exact code path **did not previously assert
the `type` field either**, so it would have silently continued to pass a broken request shape
even after other changes — DH-0120 fixed the test to assert `type: "function"` explicitly
(see `openai-compatible.test.ts` around line 218-233, with an inline comment: "tool_calls
missing 'type': 'function' — caught live, this test previously didn't assert the type field
either") specifically so this can't silently regress again.

**Live verification**: DH-0120 re-ran the exact crashing scenario (multi-turn Bash tool call
via `gemma4`/`mantle-openai`) end to end after the fix and confirmed it completes
successfully (`ReportOutcome` called, correct result).

**Lesson for anyone touching this adapter again**: `openai-compatible.ts` had been unit-
tested and shipped (DH-0107) before this bug was found — the unit tests were not sufficient
to catch it because they mirrored the same incomplete assumption the implementation made.
This class of bug (a schema field the model *provider* silently doesn't enforce but a real
one does) is specifically why DH-0119's live-verification discipline against a real,
strictly-validating endpoint mattered — don't trust "unit tests pass" alone for wire-format
correctness against a new real endpoint; treat the first live call to any new endpoint as
part of the correctness bar, not a formality.

Section 3c below covers a third finding, from the same investigation, that the owner
specifically flagged as needing its own dedicated section rather than being buried here — see
"The Berm Entitlement Gate" section after §3.

## 3c. The Berm Entitlement Gate (DH-0118 → DH-0119)

This gets its own heading (per explicit owner instruction) because it produced a wrong
intermediate conclusion that cost real investigation time, and because a future agent hitting
a similar 401 should see this whole arc before repeating the same wrong turn.

**The literal, real error, verbatim, as returned by the live Mantle endpoint:**

```
HTTP 401: {"error":{"code":"access_denied","message":"Berm is not enabled for this account","param":null,"type":"permission_denied_error"}}
```

This fired specifically on `mantle-openai` calls to `google.gemma-4-31b` — even though
Mantle's own model catalog (`GET /v1/models`) confirmed it recognizes that exact model id.
"Berm" (not "Mantle") appearing in the error is a real, verbatim observation from AWS's own
response, not a transcription typo in this repo's tickets — DH-0118 speculated it's an
internal/legacy AWS service name that predates or sits behind the customer-facing "Mantle"
branding, worth mentioning by name if ever contacting AWS Support about this class of error
since their internal tooling may only recognize the "Berm" name.

**Why this was genuinely hard to diagnose — the misleading part, precisely.** The wire
response was not an ambiguous or generic failure that would naturally prompt "maybe I have
the wrong URL" — it was a clean `HTTP 401` with a well-formed, correctly-structured AWS-style
error envelope: a `code` (`access_denied`), a `type` (`permission_denied_error`), and a
human-readable `message`. Every structural signal in that response looks exactly like what a
genuine, real AWS entitlement denial looks like — the same shape you'd get from a real IAM/
Bedrock model-access-not-granted error elsewhere in this project's testing. There was no
404, no "route not found," no generic proxy error, nothing that would hint the request had
landed on a *different, wrong* endpoint that happened to still be a live, correctly-behaving
part of Mantle's own infrastructure (the unprefixed `/v1/chat/completions` path is itself a
real, working Mantle route for other models — it isn't a dead or misconfigured URL, it's just
the *wrong* route for this particular model). That combination — a real service, returning a
well-formed, AWS-shaped permission error, from a URL that itself resolves and responds
normally — is what made "this is an account/entitlement problem" the natural first read
rather than "this is a routing/prefix problem." The signal that actually *looked* wrong
(a real permission-denied response) was not the dimension that was actually wrong (the URL
path). Nothing in the 401 body itself mentions the requested path, prefix, or routing at all
— the error gives no structural hint that the fix is a URL change rather than an AWS Support
request. What finally cut through it was not re-reading the error text harder; it was
external corroboration outside the error response itself: a working request sample the owner
provided directly, plus a real `GET /v1/models` catalog call proving the model *was* known to
Mantle (ruling out "wrong model id" and "no account access to Mantle at all" as explanations)
combined with third-party documentation that had independently catalogued this exact
prefix-routing quirk for this exact model. In other words: the fix was found by testing a
different request shape against outside evidence, not by parsing the misleading error more
carefully — a useful pattern to remember when a future error looks maximally specific and
official but the specificity turns out to be about the wrong thing.

**Phase 1 — DH-0118's initial (wrong) turn.** Reading only this single 401, DH-0118 first
guessed a bespoke SigV4-signed adapter was needed (i.e., that the `openai-compatible`
bearer-token wiring itself might be the wrong auth mechanism for Mantle), and separately
concluded the "Berm is not enabled" message meant a real, distinct AWS-side account
entitlement gate on top of base Mantle access — something that would need to be requested
from AWS Support and simply wasn't granted on the operator's account yet. Under that theory,
this would NOT be a code bug at all: the plumbing (adapter, provider config, endpoint URL
shape) would already be correct, and `gemma4` would just start working the moment AWS granted
that entitlement — no further code action needed, only re-running `dh doctor` once granted.
DH-0118 also confirmed this 401 was independent of auth mechanism: both bearer `apiKey` and
SigV4 hit the identical 401, which is part of why the entitlement-gate theory looked
plausible at the time (a routing bug would more naturally depend on which client/path was
used, not persist identically across two different auth mechanisms tested against the same
wrong path).

**Phase 2 — DH-0119's correction, after the owner pushed back.** The owner did not accept the
"just wait for AWS to grant access" conclusion as final and pushed for further live testing.
With a real filled-in `BEDROCK_MANTLE_API_KEY`, a working sample the owner provided directly,
and a real `GET /v1/models` catalog listing confirming Mantle recognizes
`google.gemma-4-31b`, DH-0119 found the *actual* root cause: **"Berm is not enabled" is a
misleading error Mantle returns when a model that requires the `/openai`-prefixed path
(`/openai/v1/chat/completions`) is routed to the unprefixed path (`/v1/chat/completions`)
instead — it is not an account-level entitlement gate at all.** This was corroborated by a
third-party gateway's documentation (truefoundry.com) explicitly listing `google.gemma-4-31b`
(alongside `google.gemma-4-e2b`, `google.gemma-4-26b-a4b`, `openai.gpt-5.5`, `openai.gpt-5.4`,
`xai.grok-4.3`) as needing the prefixed path specifically. Confirmed live: the identical
request against `/openai/v1/chat/completions` (instead of the unprefixed `/v1/chat/completions`)
returned a real `200` with a real completion. The fix was simply correcting `mantle-openai`'s
`baseURL` to `https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1` — that is the value
present in the current `dh.json` (confirm it hasn't drifted before trusting it).

> [!IMPORTANT]
> **DH-0119 is the final, correct conclusion — DH-0118's entitlement-gate theory is
> superseded and should be treated as historically informative only, not as current status.**
> `gemma4` is not blocked on an AWS-side grant today: it is live-verified working end to end,
> including real tool use, per §5. If a future agent sees this "Berm is not enabled" error
> again, the first thing to check is the URL path (`/openai/v1/...` vs `/v1/...`), not AWS
> account entitlements, and not the auth mechanism (bearer vs SigV4) — both of those were
> tested and ruled out as the cause. Do not re-open a bespoke-SigV4-adapter investigation or
> file an AWS Support ticket requesting a "Berm" entitlement based on this error text alone;
> that was DH-0118's wrong turn, corrected by DH-0119.

**Known, explicitly-flagged, not-yet-generalized limitation** (carried forward from DH-0119,
still true as of this writing): which models need the `/openai` prefix is **not derivable
from the model catalog itself** (per the same third-party docs). `mantle-openai`'s `baseURL`
is hardcoded to always use the `/openai` prefix, which happens to be correct for every model
currently configured in that provider slot (`gemma4`), but would silently be **wrong** for a
future model added to the same provider entry that needs the *unprefixed* path instead.
DH-0119 explicitly decided not to generalize this until it's an actual problem. If you add a
new Mantle-openai-routed model, check empirically (a real live call) which path it needs — do
not assume the existing prefix is universally correct.

## 4. Exact configuration shape (real, verified — from the committed `dh.json`)

This is the live, committed configuration in the repo root `dh.json` — not a reconstruction:

```json
{
  "models": [
    { "name": "gemma4", "provider": "mantle-openai", "model": "google.gemma-4-31b" },
    { "name": "haiku-mantle", "provider": "mantle-anthropic", "model": "anthropic.claude-haiku-4-5" }
  ],
  "provider": [
    {
      "name": "mantle-anthropic",
      "type": "anthropic",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    {
      "name": "mantle-openai",
      "type": "openai-compatible",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    }
  ]
}
```

Notes on this shape:

- `mantle-anthropic` is `type: "anthropic"` (not a bespoke type) pointed at Mantle's
  `/anthropic` route — this is the same `type: "anthropic"` used for the real Anthropic API
  and for any Anthropic-Messages-shaped local/custom endpoint (see `docs/CONFIGURATION.md`'s
  `type: "anthropic"` section, which explicitly notes "It's also how Bedrock Mantle's
  Anthropic-shaped route is configured").
- `mantle-openai` is `type: "openai-compatible"` (DH-0107's adapter) pointed at Mantle's
  `/openai/v1` route.
- Both share one credential, `$(BEDROCK_MANTLE_API_KEY)` — a plain bearer token generated via
  the AWS Bedrock console (a Bedrock long-term API key), interpolated into the standard
  `apiKey` field. **Not** an AWS SDK SigV4 credential-chain lookup, even though it's an AWS
  service — this is deliberate (DH-0107 Architect Design §3): `apiKey` was already a generic
  bearer-token slot with `$(VAR)` interpolation and DH-0020 redaction coverage with zero
  provider-type branching, so no new credential field was added.
- `$(AWS_REGION)` is interpolated into the URL itself, since Mantle is a plain HTTP endpoint
  with no SDK to hand a bare region string to (unlike `type: "bedrock"`'s separate `region`
  field, which the AWS SDK client consumes directly).
- `docs/CONFIGURATION.md` (§"Amazon Bedrock Mantle" section, roughly lines 213-238) documents
  this exact shape and is consistent with the current `dh.json`, aside from the tool-use
  characterization noted in §3a above.

## 5. What "live verified" in DH-0119 actually means (and doesn't)

Be precise about what evidence exists, since this distinction is easy to blur:

**Actually proven, with real evidence:**
- `haiku-mantle` (Mantle's `/anthropic` route): `dh doctor` PASS, real completions returned,
  against a real `BEDROCK_MANTLE_API_KEY` and real AWS infrastructure.
- `gemma4` (Mantle's `/openai/v1` route): `dh doctor` **plain `PASS`, including the tool-use
  probe** — i.e., an end-to-end real HTTP round trip that included a real `tool_use`/
  `tool_calls` block coming back from the model, not just connectivity. This is explicitly
  called out as "the first real evidence on real Gemma 4 behavior this project has had"
  (DH-0106's earlier claim about Gemma-family tool-use reliability was based on Gemma 3, an
  untested assumption for Gemma 4 specifically).
- The DH-0120 crash scenario (multi-turn tool call replay) was re-run live post-fix and
  confirmed working end to end.
- `GET /v1/models` against the real Mantle endpoint was used to confirm Mantle's catalog
  actually recognizes `google.gemma-4-31b` — not inferred from docs alone.
- Both bearer-`apiKey` auth and SigV4 were live-tested against Mantle and found to produce
  identical results (DH-0119 summary) — bearer is what `dh` uses, but this rules out a theory
  that Mantle secretly requires SigV4.

**Not proven / explicitly out of scope:**
- The other models the third-party docs mention as needing the `/openai` prefix
  (`google.gemma-4-e2b`, `google.gemma-4-26b-a4b`, `openai.gpt-5.5`, `openai.gpt-5.4`,
  `xai.grok-4.3`) have not been added to `dh`'s config or live-tested by this project at all.
- Whether other Mantle-servable model families (Mistral, DeepSeek, Qwen, Grok, per DH-0118's
  research) work through `dh`'s existing `anthropic`/`openai-compatible` types has not been
  tested — plausible by the same reasoning (they're the same two wire shapes) but unverified.
- The claim that "which models need the `/openai` prefix isn't derivable from the catalog" is
  itself sourced from third-party documentation (truefoundry.com), not from AWS's own docs or
  from `dh`'s own exhaustive testing — treat it as a working hypothesis that has held so far,
  not a guaranteed-permanent fact about Mantle's API design.

## 6. Current implementation status and discrepancy check

All five tickets (DH-0106, DH-0107, DH-0118, DH-0119, DH-0120) are `status: closed,
resolution: done`. Cross-checked against the actual current source (2026-07-18):

- `src/contracts/config.ts` (or its current equivalent — confirm the exact file if it's moved
  since a config-type reorg): `ProviderType` includes `"openai-compatible"`, per
  `src/config/validate.ts:19` (`const PROVIDER_TYPES = ["anthropic", "bedrock",
  "openai-compatible"] as const;`) — matches DH-0107.
- `src/agent/providers/openai-compatible.ts` exists, implements `ModelProvider`, and **does**
  include `type: "function"` on outgoing `tool_calls` at all three relevant spots (the
  `OpenAiChatMessage.tool_calls` type declaration, the request-building tool-call push in
  `toOpenAiMessages()`, and the top-level `tools` array construction in `complete()`) —
  matches DH-0120's fix, still present, not regressed.
- `src/agent/providers/index.ts`'s `createProvider()` switches on `config.type` and returns
  `OpenAiCompatibleProvider` for `"openai-compatible"` — wired correctly.
- `dh.json` (repo root) has both `mantle-anthropic` and `mantle-openai` provider entries and
  `gemma4`/`haiku-mantle` model entries exactly as described in §4 — matches DH-0119's final
  state, not DH-0118's earlier (wrong) single-route guess.
- `docs/CONFIGURATION.md` documents all of this in detail (the `type: "openai-compatible"`
  section and the dedicated "Amazon Bedrock Mantle" section) and is broadly accurate, **with
  one flagged discrepancy**: it still describes `gemma4` as unreliable for tool use ("reliably
  hallucinates tool calls"), which appears to be carried over from DH-0106's Gemma-3-specific
  finding rather than updated to reflect DH-0119's later, more favorable plain-`PASS`
  tool-use-probe result for real Gemma 4. Recommend a documentation follow-up to reconcile
  this — not fixed as part of this guide since fixing `CONFIGURATION.md`'s prose is a
  judgment call about current model behavior that should be re-verified live rather than
  silently rewritten based on a ticket read.
- `git log` confirms the implementation commits: `53482eb` (DH-0107 initial adapter),
  `a67a2b4` (DH-0120 fix). No DH-0118/DH-0119-specific commit hash appears in the file
  history for `openai-compatible.ts`/`bedrock.ts` — those tickets' changes were to `dh.json`
  and `docs/CONFIGURATION.md`, not to provider adapter code (consistent with §1's point that
  no new adapter code was needed for Mantle).

**Conclusion: this is fully implemented and shipped, not partial.** The only loose end is the
documentation-prose discrepancy above, plus the explicitly-acknowledged unverified model list
and unverified `/openai`-prefix-generalization gap in §5/§3c.

## 7. Open questions / known gaps carried forward, explicitly

Preserving these verbatim in intent so they aren't silently dropped:

1. **`/openai`-prefix routing is hardcoded, not derived from the model catalog** (DH-0119).
   Works today because every model currently in `mantle-openai`'s slot needs the prefix; will
   silently misroute (producing the same misleading "Berm is not enabled" error as §3c) if a
   future model needing the *unprefixed* path is added to the same provider entry without
   noticing. If this becomes a real problem, the fix likely needs either a per-model
   path-override mechanism or empirical detection — not designed yet.
2. **Only `google.gemma-4-31b` is live-verified** among the models Mantle's `/openai` route
   reportedly serves. `google.gemma-4-e2b`, `google.gemma-4-26b-a4b`, `openai.gpt-5.5`,
   `openai.gpt-5.4`, `xai.grok-4.3` are only third-party-documented, not tested by this
   project. Adding any of them to `dh.json` should go through the same live-verification
   discipline (real `dh doctor` run with a real `BEDROCK_MANTLE_API_KEY`) before being
   trusted, per this project's established pattern (see CLAUDE.md §9's TDD/BDD discipline and
   this whole thread's repeated live-vs-assumed distinctions).
3. **`docs/CONFIGURATION.md`'s "chat-only" characterization of `gemma4` needs a status check**
   — it doesn't match DH-0119's later plain-`PASS` tool-use-probe result. Worth a fresh
   `dh doctor` run against `gemma4` before editing the docs, since model behavior over an
   evolving Bedrock Mantle service could itself have changed since DH-0119 (2026-07-17).
4. **Other Mantle-servable model families** (Mistral, DeepSeek, Qwen, Grok, per DH-0118's
   research) are plausible via the same two provider types but genuinely untested.

## 8. If you are implementing (or re-implementing) this from scratch: the actual sequence

For a future agent who somehow has to redo this (e.g. the code regressed, or a similar
Mantle-like endpoint shows up for a different vendor), here is the sequence that actually
worked, condensed:

1. **Do not assume Mantle needs a new provider type.** Check first whether it speaks a wire
   shape `dh` already has an adapter for (Anthropic Messages, or OpenAI Chat Completions).
   Both DH-0107 (Gemma 4 generally) and DH-0118→DH-0119 (Mantle specifically) initially
   guessed "needs bespoke code" and were wrong or over-scoped; the right adapter already
   existed in both cases. Only build new provider-adapter code (`src/agent/providers/*.ts`)
   if the endpoint's request/response shape genuinely doesn't match `anthropic.ts` or
   `openai-compatible.ts`'s translation logic.
2. **Confirm credential shape before designing a new config field.** `apiKey` (bearer token,
   `$(VAR)`-interpolated, already redacted by `src/server/redact.ts`'s generic
   `collectConfigSecrets` sweep with no per-type branching) covers "any bearer-token secret."
   Don't add a new field unless the auth mechanism is structurally different (e.g. actually
   needs SigV4 signing, which Mantle does NOT — bearer works and is what's used).
3. **If it's genuinely a new wire shape**, that's a `src/contracts/` change (a new
   `ProviderType` union member) and needs architect sign-off per CLAUDE.md §6 before Core
   implementation — see DH-0107's Architect Design section for the exact reasoning template
   to follow (adapter-shape analysis, credential-shape analysis, API-variant choice,
   agent-loop-impact analysis, scoped contracts change).
4. **Add the `provider[]` entries in `dh.json`** — for a Mantle-like gateway with
   vendor-routed sub-paths, expect **one provider entry per API surface**, not one entry
   trying to cover everything (this was DH-0118's core mistake, fixed in DH-0119).
5. **Live-test against the real endpoint with a real credential before trusting any of it.**
   Specifically: (a) run whatever this project's connectivity+tool-use probe is (`dh doctor`,
   as of this writing) against each new model/provider pairing; (b) explicitly test a
   **multi-turn** tool-call scenario, not just a single request — DH-0120's bug only
   manifested on the *second* turn, replaying tool-call history back to the model, and would
   have shipped invisibly if only a first-call smoke test were run; (c) if you get an
   ambiguous or unexpected error (like "Berm is not enabled"), don't trust the surface-level
   interpretation — cross-check against the actual documented API contract (path prefixes,
   required fields) before concluding it's an account/entitlement problem, since strict
   validators often return misleading error text for shape mismatches.
6. **When a live test reveals a wire-shape bug** (missing required field, wrong path, etc.),
   fix it at the translation layer (`toOpenAiMessages()`-equivalent) AND strengthen the unit
   test that exercises that exact code path to assert the previously-missing detail — per
   DH-0120, the existing unit test had already been exercising the buggy code path without
   catching it, precisely because it didn't assert the field that was missing.
7. **Update `docs/CONFIGURATION.md`** with the real, verified config shape (not a guessed
   one) and be explicit in the prose about what's actually live-verified vs. still assumed —
   this project's own docs already model that discipline (see §"Amazon Bedrock Mantle" there)
   and it's worth preserving.
8. **File/close tickets with the live-verification evidence recorded in the ticket's Notes**,
   not just "done" — the specific error strings, the specific fix commit, and the specific
   re-run confirmation are what made this guide possible to reconstruct precisely. A
   `resolution: done` ticket without that evidence trail would have made §3's bugs much
   harder to preserve accurately.

## References

- `tracking/DH-0106-gemma4-bedrock-default-model-hallucinates-tool-calls-instead-of-making-them.md`
- `tracking/DH-0107-real-gemma-4-support-requires-a-new-provider-type-bedrock-mantle-openai-compatible-api.md`
- `tracking/DH-0118-amazon-bedrock-mantle-is-a-real-separate-endpoint-wire-it-up-as-its-own-provider-not-folded-into-bedrock.md`
- `tracking/DH-0119-real-bedrock-mantle-integration-live-verified-mantle-anthropic-mantle-openai.md`
- `tracking/DH-0120-openai-compatible-provider-omitted-required-type-function-on-outgoing-tool-calls.md`
- `src/agent/providers/openai-compatible.ts`
- `src/agent/providers/openai-compatible.test.ts`
- `src/agent/providers/index.ts`
- `src/agent/providers/types.ts`
- `src/config/validate.ts`
- `dh.json` (repo root)
- `docs/CONFIGURATION.md`
