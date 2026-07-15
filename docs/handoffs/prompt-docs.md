# Handoff: System prompt, skills, README

**Addressed to:** the Prompt domain lead.
**Owner paths:** `src/prompt/`, `README.md` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `METHODOLOGY.md` in full and `CLAUDE.md`, plus `HANDOFF.md` §6, §11 before starting.
Two related deliverables: the built-in system prompt every `dh` agent runs with, and the
project's public-facing README.

## Scope

### 1. `src/prompt/` — built-in system prompt

- Bake a default system prompt into the binary, overridable via `DhConfig.systemPrompt`
  (a file path — `src/config/` loads it, you own the built-in default text and the
  enumeration logic).
- **Enumerate available skills** (name + description) in the prompt, Claude-Code style —
  tools themselves go through the model's tools parameter, not prose-listed in the prompt.
- **Encode the working discipline of `METHODOLOGY.md`** directly in the prompt text, since
  `dh` exists to run that methodology: escalate-don't-guess, commit-before-yield,
  status-supersedes, self-contained handoffs. Sub-agents get this same base prompt plus
  their spawn prompt (that composition happens in `src/agent/`, Core's territory — you own
  the prompt *text*, not where it's spliced in).
- State plainly in the prompt that **all output is automatically logged** (ADR 0005), so an
  agent's plain-text output is itself how it records reasoning/status — it never needs to
  call a logging tool.
- Bundle a **CLI-tools skill** (a `SKILL.md` under a skill directory you define, discovered
  via `skillPaths`) covering the domain-specific CLIs called out in `HANDOFF.md` Appendix A
  as bold: `git`, `gh`, `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`,
  `curl`. Skip generic POSIX tools (`echo`, `grep`, `sed`, `find`, `cat`, `head`, `tail`,
  `ls`, `sort`, `wc`, …) — models already know those.
- Expose a function like `loadSystemPrompt(config: DhConfig): Promise<string>` that Core's
  agent loop calls — coordinate the exact signature in your status log.

### 2. `README.md` — GitHub landing page

- Attractive, welcoming: logo/wordmark is welcome but not required this round (note if
  deferred), clear one-paragraph pitch, quick start (`bunx dark-harness`, or build from
  source), the mode matrix from `HANDOFF.md` §2, a `dh.json` config reference (link to or
  summarize ADR 0007), and **the air-gap security stance stated up front** (ADR 0004 —
  plaintext default, optional token/TLS, air-gapping is the real posture).
- Link to `METHODOLOGY.md` and `CLAUDE.md` for contributors who want the fleet-orchestration
  context, but the README itself is written for a user evaluating the tool, not a
  contributor — lead with what it does and how to run it.

## Constraints

- Import config/prompt-relevant types from `src/contracts/` where applicable (e.g.
  `DhConfig`). Don't redeclare them.
- Stay inside `src/prompt/` and `README.md`. If the skill-loading mechanism needs something
  from `src/config/` (Core) that doesn't exist yet, state it as a request in your status
  log.

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in src/prompt/ (prompt assembly logic,
                         # skill enumeration) — the prompt *text* itself isn't "tested" in
                         # the coverage sense, but the code that builds it is.
```
README has no gate beyond lint/spellcheck-by-eye — it's prose, not code.

## Definition of done (this round)

- `loadSystemPrompt` (or equivalent) produces a prompt containing the methodology
  discipline points, the skill enumeration, and the logging statement, tested against a
  fixture `dh.json`/skill-directory setup.
- The CLI-tools skill exists as a real `SKILL.md` and is discoverable via `skillPaths`.
- `README.md` covers: pitch, quick start, mode matrix, config reference, security stance.
- Anything deferred (e.g. logo/wordmark, additional skills) is named explicitly.

## Status log

### 2026-07-15 — Iris (Prompt domain lead), first round

**Built:**

- `src/prompt/skills.ts` — `Skill` type (`name`, `description`, `source`) and skill
  discovery: `parseSkillFrontmatter(content)` (a deliberately minimal frontmatter reader —
  flat `key: value` lines, optionally double-quoted with `\"`/`\\` escapes; every real
  SKILL.md observed, including this project's own, fits that shape, so a full YAML parser
  wasn't worth the dependency) and `discoverSkills(skillPaths)` (async, scans each configured
  directory's immediate subdirectories for a `SKILL.md`; missing directories, non-directory
  entries, missing/malformed `SKILL.md`, and races like a dangling symlink are all skipped
  gracefully rather than throwing — one bad skill directory can't take down prompt loading).
- `src/prompt/system-prompt.ts` — the built-in prompt text (methodology discipline:
  escalate-don't-guess, commit-before-yield, status-supersedes, self-contained handoffs,
  no-silent-truncation; plus the "your output is automatically logged, you never call a
  logging tool" statement per ADR 0005) and:
  - `loadSystemPrompt(config: DhConfig): Promise<string>` — the signature named in the
    handoff. If `config.systemPrompt` is set it's a **full override**: reads that file
    verbatim (trimmed), no skill injection — the operator owns the whole prompt at that
    point. Otherwise builds the default prompt with skill enumeration.
  - `buildDefaultSystemPrompt(config)` and `renderSkillsSection(skills)` exported
    separately for testability and reuse.
  - `CLI_TOOLS_SKILL` — the bundled skill's `{ name, description }`, parsed from the real
    `SKILL.md` at module load (not hand-duplicated, so the prompt text can't drift from the
    file), with a hardcoded fallback only for the theoretical case that file's frontmatter
    ever breaks.
- `src/prompt/skills/cli-tools/SKILL.md` — the real bundled skill, covering `git`, `gh`,
  `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`, `curl` per HANDOFF.md
  Appendix A's bold entries. Always enumerated in the default prompt, independent of
  `config.skillPaths`.
- `src/prompt/md-text.d.ts` — ambient `declare module "*.md"` so `import ... from
  "./skills/cli-tools/SKILL.md" with { type: "text" }` typechecks. **Design call:** the
  skill's content is imported as a Bun text asset specifically so `bun build --compile`
  embeds it into the binary — verified locally (compiled a throwaway binary, deleted the
  source `.txt` fixture, ran the binary, content was still there). bun-types ships this
  declaration for `*.txt` but not `*.md`; added the missing one scoped to `src/prompt/`
  rather than touching a shared config.
- `README.md` — pitch, air-gap security stance up front (before quick start, per ADR 0004's
  weight), quick start (`bunx dark-harness` + build-from-source), the full mode matrix
  (HANDOFF.md §2 / ADR 0001), a `dh.json` reference kept in sync with ADR 0007 by hand,
  the bearer-token/TLS section (ADR 0004 Addendum B), a short tools/skills/logging summary,
  and links to METHODOLOGY.md/CLAUDE.md for contributors.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass — 100%
line and function coverage on every file touched (`src/prompt/skills.ts`,
`src/prompt/system-prompt.ts`, including the bundled `SKILL.md` text asset itself, which
Bun's coverage tool tracks as a file).

**Deferred, named explicitly:**

- No logo/wordmark in the README (noted in its own "Status / deferred" section).
- No skills beyond the one bundled `cli-tools` skill this round.
- `README.md`'s `dh.json` sample is maintained by hand against ADR 0007, not generated from
  `src/contracts/config.ts` — fine for now, but will drift silently if the contract changes
  without a README follow-up. Flagging so a future pass (mine or another domain's) considers
  a generated/checked reference.
- Did not touch `bunfig.toml` / any repo-wide coverage-threshold enforcement — `src/prompt/`
  hits 100% on its own, but I didn't verify whether CI/Release's gate wiring expects a
  `[test] coverageThreshold` in `bunfig.toml` versus deriving pass/fail from the `bun test
  --coverage` table output some other way. Flagging as a heads-up for CI/Release, not a
  blocker for this handoff.

**Cross-domain requests:**

- To Core (`src/config/`, `src/agent/`): the `Skill` tool (your territory) will need a way
  to load a skill's *full* instructional body by name at invocation time, not just the
  name+description this domain enumerates in the prompt. For skills discovered via
  `config.skillPaths` that's a plain file read. For the bundled `cli-tools` skill, its
  content only exists as a `.md`-text import baked into this binary (see `md-text.d.ts`
  above) — there's no on-disk `SKILL.md` next to a compiled `dh` binary to fall back to. If
  the `Skill` tool's lookup is purely filesystem-based, invoking `cli-tools` by name will
  fail in a compiled binary even though it's listed in the prompt. Two options I see: (a)
  Core's `Skill` tool special-cases a small set of builtin skills exported from
  `src/prompt/` (I can export the raw body text alongside `CLI_TOOLS_SKILL` if useful —
  say the word), or (b) treat "builtin" skills as pre-resolved and have the agent loop pass
  their full content in some other way. Not blocking this round since `Skill`-tool
  implementation is still open per `docs/handoffs/core.md`, but wanted it flagged before
  that lands and the mismatch becomes a silent runtime gap.
- No changes requested to `src/contracts/` this round — `DhConfig.systemPrompt` and
  `skillPaths` were sufficient as-is.

— Iris (she/her), Prompt domain lead, persistent for this build.

---

## Round 2 — OPEN — a tool call is never fire-and-forget

**Addressed to:** Prompt (Iris, resumed — read `docs/roster/iris.md` first).

Confirmed via extensive real testing against local models (LM Studio, gemma-4-e4b/31b):
the model routinely starts a background task (a backgrounded `Bash` call, most commonly)
and then simply ends its turn without ever following up via `Monitor`/`TaskOutput` to see
the result — treating the tool call as fire-and-forget. This isn't a code bug (the loop
correctly reports the model's own `end_turn` with no further tool call as a completed turn,
per Round 5's now-correct interactive-session semantics) — it's a prompting gap. Smaller/
local models clearly don't infer this obligation on their own the way Claude does.

**Fix:** add an explicit, pushy discipline point to `BASE_PROMPT`'s "Working discipline"
section in `src/prompt/system-prompt.ts`, in the same style as the existing bullets
(Escalate-don't-guess, Commit-before-yield, etc.) — something along the lines of: **a tool
call is never fire-and-forget.** If a tool starts work whose result isn't immediately
visible (a backgrounded shell command, a spawned sub-agent), you are responsible for
following up on it — check `Monitor`/`TaskOutput` before considering your turn done. Ending
a turn without checking on a background task's result abandons it, it does not complete it.
Word it as strongly as the other discipline points; this is a correctness requirement, not a
suggestion. Your call on exact phrasing/placement, but it needs to be unambiguous enough
that a small model reliably picks up on it (short, direct, impossible to miss — avoid
burying it in a long paragraph).

**Gates:** the standard three. Update `system-prompt.test.ts`'s existing prompt-content
assertions if they snapshot/check the discipline section, so they reflect the addition
rather than fail. Append a dated status entry here and update `docs/roster/iris.md` when
done. (This can't be "live-verified" against a specific model the way code fixes have been
in this session — a small local model choosing to poll a background task is a probabilistic
improvement, not a guaranteed one. Note that honestly rather than claiming it's proven.)

### 2026-07-15 — Iris (Prompt domain lead), Round 2

**Built:** added a sixth bullet to `BASE_PROMPT`'s "Working discipline" section in
`src/prompt/system-prompt.ts`, immediately after "No silent truncation.", in the same
bolded-phrase style as the existing five:

> **A tool call is never fire-and-forget.** If a tool starts work whose result is not
> returned immediately — a backgrounded Bash command, a spawned sub-agent — your turn is
> NOT done until you have followed up and looked at the result, using Monitor or
> TaskOutput. Ending your turn right after kicking off a background task, without ever
> checking back on it, is a failure to complete the task, not a valid way to finish it.
> Treat every background task you start as an open obligation until you have confirmed its
> outcome.

Kept it short and direct per the handoff's ask, named the two follow-up tools by name
(`Monitor`, `TaskOutput`) so a small model has a concrete next action rather than an
abstract obligation, and stated the negative case explicitly ("ending your turn right
after... is a failure") since the failure mode observed in testing was exactly that: the
model treating an unfinished background task as an acceptable stopping point.

Updated `system-prompt.test.ts`'s `buildDefaultSystemPrompt` content-assertion test to also
check for `"A tool call is never fire-and-forget."` — added as a new `expect`, not a
replacement, so the existing assertions (including the bullet-shape regex that isolates
skill lines from discipline lines) still hold unchanged.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass — 688 tests,
0 failures, 100% line/function coverage retained on `src/prompt/system-prompt.ts`.

**Honesty note:** per the handoff's own caveat, this is not live-verified against a specific
local model choosing to poll — that would require a live LM Studio session outside this
environment. It's a prompt-text change reviewed for clarity and directness, not a proven
behavioral fix.

— Iris (she/her), Prompt domain lead, persistent for this build.

---

## Round 3 — OPEN — two more gaps found by an architect-level review

**Addressed to:** Prompt (Iris, resumed — read `docs/roster/iris.md` first).

Fable (architect-on-call) ran a full gap analysis comparing `HANDOFF.md`'s intent against
what's built. Two findings are Prompt-domain, both small system-prompt text additions in the
same file/style as your Round 2 fire-and-forget fix — bundled into one round.

### 3a. `TASK_FAILED` self-report convention was never taught to the model

Confirmed directly (grep across the repo): `TASK_FAILED` appears only in `src/agent/loop.ts`
— the code that scans final assistant text for the marker and treats its presence as
self-reported failure (ADR 0006's exit-code contract depends on this: no marker + no tool
call = success, marker present = failure). `loop.ts`'s own header comment states plainly:
"The system prompt must instruct the model to emit `TASK_FAILED`... that's a request to the
Prompt domain, not implemented here" — a Core round-1 cross-domain request that was never
picked up. The model has **never once been told this convention exists.** A locked
architectural decision (ADR 0006) currently has a load-bearing dependency on prompt text
that doesn't exist.

**Fix:** add a clear discipline point (or a dedicated short section — your call) to
`BASE_PROMPT` explicitly teaching: if you cannot complete the given instructions, say so by
including the literal text `TASK_FAILED` somewhere in your final response; if you complete
successfully, don't include it. State it plainly enough that it reads as a hard requirement,
not a suggestion — this is the entire mechanism the harness uses to know success from
failure when no tool call ends the conversation.

### 3b. No guidance on background-task polling cadence

A predictable next failure mode after your Round 2 fix: telling a model to "check back" on a
background task doesn't say *how* — nothing guides it toward a sensible cadence (do other
useful work and check later; wait an appropriate interval) versus spin-polling `Monitor` in
a tight loop or waiting an arbitrarily long/short time.

**Fix:** a short discipline addition, same style/location as Round 2's fix, giving concrete
guidance — e.g. after starting a background task, either continue other independent work
and check back later, or wait a reasonable interval before polling again; don't call
`Monitor` in an immediate tight loop.

**Gates:** the standard three. Update `system-prompt.test.ts`'s content assertions to cover
both additions. As with Round 2, you can't fully behaviorally prove either fix against a real
small model in this environment — that's fine, note it honestly rather than overclaiming.
Append a dated status entry here and update `docs/roster/iris.md` when done.

### 2026-07-15 — Round 3 status: done

Added two more bullets to `BASE_PROMPT`'s "Working discipline" list in
`src/prompt/system-prompt.ts`, same style as Round 2 (bolded lead phrase, concrete and
directive):

- **Pace your polling** (3b): after starting a background task, either go do other
  independent work and check back once there's something to show for it, or wait a
  reasonable interval before polling again — explicitly names tight-loop `Monitor` polling
  as the failure mode to avoid, while cross-referencing the Round 2 rule so the two don't
  read as contradictory (check back, but not too fast).
- **Report failure with `TASK_FAILED`** (3a): states the literal marker requirement as a
  hard rule, not a suggestion — a final response with no tool call and no marker is success;
  the marker means failure; never include it on a successful completion. This directly
  closes the gap Fable found: `TASK_FAILED` detection existed in `src/agent/loop.ts` but was
  never taught to the model anywhere in the prompt.

Updated `system-prompt.test.ts` with three new assertions covering both additions
(`"Pace your polling."`, `"Report failure with \`TASK_FAILED\`."`, and a bare `"TASK_FAILED"`
containment check).

**Gates:** `bun run typecheck` passes. `bun run test:coverage` passes — 693/693 tests,
100% coverage on `src/prompt/system-prompt.ts` (and all other files touched by other
domains' parallel work). `bun run lint` reports one pre-existing failure on an untracked
`dh.json` at the repo root (a formatting issue unrelated to and predating this task, not
under `src/prompt/` — left untouched per scope).

**Honesty note carried forward from Round 2:** both are prompt-text changes, not
behaviorally verified against a live small-model session — no way to test that from this
environment. Worth confirming later against an actual model run.

---

## Round 4 — OPEN — README: Bedrock setup section

**Addressed to:** Prompt (Iris, resumed — read `docs/roster/iris.md` first).

E2E's Round 5 (just landed) built real end-to-end coverage for the Bedrock provider, and
flagged that README.md's Bedrock guidance is currently just the one-line sample config entry
— no setup guidance for a real operator. Content to cover, per E2E's own notes:

- The `provider.region` config field (`ProviderConfig.region` in `src/contracts/config.ts`).
- Standard AWS credential-chain resolution — `bedrock.ts` does **no custom credential
  handling**: env vars (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`),
  shared config file (`~/.aws/credentials`), or an instance/container role all work via the
  AWS SDK's own default chain — same as any AWS CLI tool.
- Bedrock errors (invalid/legacy/deprecated model ids, access-denied, etc.) surface through
  the same `ProviderError` wrapping as the Anthropic provider — nothing Bedrock-specific to
  explain about error shape.
- Worth mentioning (found via real testing this session): Bedrock model identifiers can be
  region/account-specific and some are deprecated/legacy even when syntactically valid — a
  real "invalid model" or "access denied" error from Bedrock is usually an account/model
  availability issue, not a `dh` configuration problem.

**Gates:** none beyond your existing ones — this is a docs-only addition. Append a dated
status entry here and update `docs/roster/iris.md` when done.

### 2026-07-15 — Round 4 status: done

Added an "AWS Bedrock setup" subsection to `README.md`, placed right after the `dh.json`
config-reference bullet list and before the bearer-token/TLS section (same section level,
same pattern of prose + example JSON block). Covers, per E2E's Round 5 notes:

- `provider.region` — what it's for and what happens if it's omitted (AWS SDK's own region
  resolution via `AWS_REGION`/`AWS_DEFAULT_REGION`/`~/.aws/config`).
- The standard AWS credential chain in full — env vars, shared credentials/config files
  (including `AWS_PROFILE`), and instance/container/task roles — stated explicitly that `dh`
  does no custom credential handling and there's no `dh.json` access-key field, so operators
  don't go looking for one.
- Error surfacing — same `ProviderError` wrapping as Anthropic, nothing Bedrock-specific
  about the shape.
- The practical heads-up from E2E's real testing: Bedrock model ids are region/account
  specific and some valid-looking ids are legacy/deprecated, so an "invalid model" or
  "access denied" error is usually an account/model-availability issue, not a `dh`
  configuration bug.

**Judgment call:** used a concrete, realistic example config (a named `bedrock` provider
with `region: "us-west-2"` and a versioned Bedrock Anthropic model id) rather than an
abstract placeholder, consistent with the rest of the README's config examples.

**Gates:** docs-only, no code gates apply. Read the rendered section back in place to check
it flows with the surrounding config-reference prose — no broken structure, headings, or
JSON.

No cross-domain requests. Nothing deferred.

— Iris (she/her), Prompt domain lead, persistent for this build.

### 2026-07-15 — Round 5 status: `TASK_FAILED` reliability (DH-0001)

Worked `tracking/DH-0001-task-failed-marker-reliability.md`: live testing against
gemma-4-31b showed the model correctly stating in plain English that it could not complete
an impossible task, but never emitting the literal `TASK_FAILED` marker Round 3 taught it —
so `dh` reported exit code 0 for a self-acknowledged failure.

**What I did:** strengthened the `TASK_FAILED` bullet in `BASE_PROMPT`
(`src/prompt/system-prompt.ts`) considerably:

- Restated the rule as "every time, no exceptions" rather than a single "MUST" sentence.
- Named the actual failure mode directly — writing an honest, clearly-worded admission of
  failure and then simply forgetting to also add the marker — since that's exactly what was
  observed live, not a hypothetical.
- Added a concrete worked example of both the correct form (prose + marker) and the wrong
  form (prose alone, scored as success) so the model has a literal template to pattern-match
  against instead of only an abstract instruction.
- Added an explicit self-check instruction: before ending any turn, re-read your own final
  response and ask whether it admits failure in any words; if so, add the marker.
- Kept it as a single bullet in the existing list (not a separate section) — same judgment
  as Round 3, this is one mechanism, and moving it out risks it reading as lower priority.

Updated `src/prompt/system-prompt.test.ts`'s assertions to match the new opening phrase and
added a check for the new self-check line.

**Honesty note, stated plainly per the ticket's own framing:** I have no way to re-run this
against a live gemma-4-31b session from this environment, so I cannot claim this closes the
gap — only that it's a materially stronger, more concrete version of the same prompt-text
mechanism. The ticket's own Risk section flags this exact limitation: prompt wording is
fundamentally a request the model can still fail to follow, no matter how emphatic. A model
willing to write a full honest paragraph about its own failure and then drop one specific
token is not obviously a wording problem I can prompt my way out of with confidence.

**Escalating rather than picking unilaterally:** the ticket's Open Question — whether ADR
0006's exit-code contract needs a less string-dependent self-report mechanism — is a real
design question, not just a wording gap, and any structural fix lives in `src/agent/loop.ts`
(Core's territory) and touches the exit-code contract itself (CLAUDE.md §6 escalation
trigger #4: "the exit-code contract" is explicitly named as architect-review territory). I'm
not picking a direction unilaterally. Concretely, a structural alternative worth architect
consideration: instead of (or in addition to) scanning free text for one literal string,
give the model a mandatory tool call to report terminal outcome (e.g. a `ReportOutcome`
tool with a `success`/`failure` argument) so the harness reads a structured field rather than
pattern-matching prose. That doesn't relitigate "no tool call = loop end" — it just makes
the *outcome* of that final turn structured instead of string-sniffed, which seems more
robust to weaker models' free-text variance. Flagging this as a finding for Fable /
coordinator judgment, not implementing it myself — it's outside `src/prompt/`'s ownership.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass (806/806
tests, 100% coverage retained). `bun run e2e` has pre-existing environment failures in this
sandbox (`tmux` not on `$PATH`, no chromium at `/opt/pw-browsers/chromium`) unrelated to this
change — not touched, not caused by this round.

**Ticket status:** left as `implementing` (not closed) — the prompt strengthening is a real,
committed improvement but not a verified fix, and the structural question is escalated
rather than resolved. Closing would overclaim.

— Iris (she/her), Prompt domain lead, persistent for this build.

---

## Round 6: four Spile tickets — DH-0018, DH-0039, DH-0041, DH-0042 (2026-07-15)

Picked up fresh with four already-`implementing` tickets assigned. All four closed this
round (`status: closed`, `resolution: done`); view regenerated via `spile-ops`.

### DH-0018 — `systemPrompt` override drops the contract; missing SendMessage/TaskStop and unattended-escalation guidance

Restructured `src/prompt/system-prompt.ts`: split the previously-monolithic `BASE_PROMPT`
into `DISCIPLINE_PROMPT` (the working-discipline preamble, overridable) and a new exported
`REQUIRED_CONTRACT` const (the `TASK_FAILED` bullet + the Logging section). `loadSystemPrompt`
now always appends `REQUIRED_CONTRACT` after a `config.systemPrompt` override's file contents
— an operator supplying a custom persona prompt can no longer silently lose the marker the
exit-code contract (ADR 0006) depends on. Chose "always append" over "just warn" from the
ticket's two acceptable options: it's strictly more robust (works even if the operator never
reads a startup log line) and is fully unit-testable, which a warning-only approach isn't in
the same way.

Also added two things to `DISCIPLINE_PROMPT`'s bullet list:
- Extended the "Escalate, don't guess" bullet with an explicit interactive-vs-unattended
  split: unattended (`--job`, or a sub-agent whose spawner has moved on) means state the
  blocker, proceed with the best defensible interpretation, and fall back to `TASK_FAILED`
  only if no reasonable path exists — rather than writing "escalate" as if a live operator
  is always reachable.
- A new bullet naming `SendMessage`/`TaskStop` as the tools for redirecting or ending a
  visibly stuck/looping sub-agent, since the prior text only ever named `Monitor`/
  `TaskOutput` (observation tools, not corrective ones).

Updated `src/prompt/system-prompt.test.ts` for the restructure (the override test now
expects the appended contract rather than a byte-for-byte pass-through; added coverage for
the new bullets and for `REQUIRED_CONTRACT` itself). Gates: `typecheck`, `lint`,
`test:coverage` all pass, 807/807 → 809/809 tests (see DH-0042 below for the other 2), 100%
coverage retained on `src/prompt/system-prompt.ts`.

**Judgment call not escalated further:** the ticket offered "append regardless" or "warn" as
alternatives; I judged this squarely inside Prompt's ownership (prompt text + its loading
function, `src/prompt/system-prompt.ts`) rather than something needing architect sign-off —
it doesn't touch `src/contracts/`, the exit-code detection logic in `src/agent/loop.ts`, or
change what the contract *means*, only guarantees the existing contract text is always
present. Round 5's escalated structural question (a `ReportOutcome`-style tool instead of
string-scanning) remains open and untouched — this round doesn't resolve it, just makes sure
the current string-based contract can't be silently dropped by config.

### DH-0042 — README config reference gaps + no automated drift check

Added `options.maxTurns` and `models[].inputPricePerMToken`/`outputPricePerMToken` to
README's config sample and prose (both already real fields in `src/contracts/config.ts`,
previously undocumented). Also added `src/prompt/readme-config-sync.test.ts` — a lightweight
regex-based drift guard (not a full TS parser) that extracts top-level field names from
`DhOptions` and `ModelConfig` and asserts each one is at least mentioned somewhere in
`README.md`. It runs in the normal `bun test src` gate, so a future field added to either
interface without a README mention now fails CI automatically instead of relying on manual
diligence — closing the second user story without needing a separate CI workflow change.
Replaced the old "kept in sync by hand" status note at the bottom of README with one
describing the new automated check.

**Judgment call:** the ticket's second story asked for "a check that flags README if it
drifts" without mandating *how* — I chose a `bun test`-based check over a new
`.github/workflows/` job because it's cheaper to write/maintain, runs on every existing test
invocation (local and CI both, since CI already runs `bun run test:coverage`), and needs no
CI/Release-domain coordination. Deliberately shallow by design (mention-only, not
correctness-of-description) — documented as such in the test file's own header comment so a
future reader doesn't mistake it for stronger validation than it is.

### DH-0039 — git credentials and workspace-directory convention undocumented

Doc-only. Added a "Git credentials and workspace convention" section to README (next to the
Bedrock setup section) stating the actual current behavior, verified against
`src/agent/runtime.ts` and `src/agent/tools/bash.ts`: `dh` has no `workspaceDir` config field
and does no credential handling of its own — the `Bash` tool runs at `process.cwd()` at `dh`
startup (`runtime.ts` line ~164: `this.cwd = options.cwd ?? process.cwd()`), so the operator
must start `dh` with its working directory already set to the checked-out repo. Documented
four standard git-credential patterns (mounted SSH key, `GIT_ASKPASS`, `.netrc`, PAT +
credential helper) as operator responsibility, explicitly not `dh`-specific.

### DH-0041 — missing user-facing docs bundle

Wrote the seven docs the ticket named (container/deployment docs are out of scope per the
ticket's own note — tracked separately as DH-0036):

- `docs/tui-keybindings.md` — verified against `src/tui/state.ts`'s actual `handleRootKey`/
  `handleTreeKey`/`handleAgentKey` reducers, not guessed.
- `docs/web-ui-guide.md` — tree/panel layout, token/cost display, log download, reconnect
  status, cross-checked against `src/web/client/render.ts` and `src/web/client/sse.ts`.
- `docs/instructions-authoring-guide.md` — suggested goal/scope/constraints/success-criteria
  structure with a worked example.
- `docs/jsonl-log-format.md` — user-facing reference derived directly from
  `src/contracts/log.ts` and ADR 0005 (including the `client`/`build` amendment and the
  "stopped" vs. "failed" distinction), explicitly deferring to the ADR as authoritative if
  they ever disagree.
- `docs/mcp-servers.md` — stdio/HTTP config examples, **with an explicit status note that
  the MCP client isn't wired up yet** (`src/agent/mcp.ts` only returns a synthetic
  `ToolSearch` placeholder per configured server; `McpAuth` is a documented stub per its own
  source comment) — caught this by reading the actual implementation before writing the doc,
  since the config schema being real doesn't mean the feature is.
- `docs/skills-authoring-guide.md` — frontmatter rules cross-checked against
  `parseSkillFrontmatter` in `src/prompt/skills.ts` (flat `key: value`, required
  `name`/`description`, malformed skills silently skipped).
- `docs/troubleshooting.md` — FAQ entries cross-referencing the `TASK_FAILED` reliability
  gap (DH-0001), Bedrock account/region errors, security/connect mismatches, and the MCP
  stub status above.

Also added `CHANGELOG.md` and `CONTRIBUTING.md` at repo root (named explicitly in the
ticket's Summary as distinct from the internal `CLAUDE.md`/`PLAYBOOK.md`), and linked all
nine new docs from a new "Further documentation" section in README.

**Honesty note:** every factual claim in these docs (keybindings, log schema fields, MCP
wiring status, skill frontmatter rules) was checked against the actual source referenced
inline, not written from the ticket's summary alone — the MCP stub-status catch above is the
clearest example of why that mattered.

**Gates:** doc-only tickets (DH-0039, DH-0041) needed no code gates. DH-0018 and DH-0042
together: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all pass — 809/809
tests, 100% coverage retained across `src/prompt/`. `bun run e2e` not run this round
(unrelated to any of these four tickets' scope; same pre-existing sandbox environment gaps
as prior rounds — no `tmux`/chromium available here).

— Iris (she/her), Prompt domain lead, persistent for this build.
