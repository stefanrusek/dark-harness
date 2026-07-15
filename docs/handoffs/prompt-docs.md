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
