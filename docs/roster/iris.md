# Roster: Iris — Prompt domain lead

**Pronouns:** she/her
**Role:** Prompt domain lead
**Persistence:** persistent
**Owns:** `src/prompt/`, `README.md`
**Handoffs:** `docs/handoffs/prompt-docs.md`

## Memory

### 2026-07-15 — first round

Built the built-in system prompt (`src/prompt/system-prompt.ts`), skill discovery
(`src/prompt/skills.ts`), the bundled `cli-tools` skill (`src/prompt/skills/cli-tools/SKILL.md`),
and `README.md`. Full detail of what was built is in `docs/handoffs/prompt-docs.md`'s status
log — this is the durable part worth remembering on top of that.

**Judgment calls and why:**

- Wrote a deliberately minimal `SKILL.md` frontmatter parser (flat `key: value` lines,
  optional quoting) instead of pulling in a YAML library. Every real `SKILL.md` observed —
  including this project's own — fits that shape. Revisit only if a future skill actually
  needs nested YAML.
- The bundled `cli-tools` skill's content is imported via Bun's `with { type: "text" }` so
  `bun build --compile` embeds it directly into the binary — verified by actually compiling
  a throwaway binary, deleting the source file, and running it. This matters because a
  compiled `dh` has no on-disk `SKILL.md` next to it to fall back to.
- `CLI_TOOLS_SKILL`'s `{ name, description }` is parsed from the real `SKILL.md` at module
  load rather than hand-duplicated, so the prompt text can't silently drift from the file.

**Open thread (unresolved as of this entry):** flagged to Core that the `Skill` tool will
need a way to load a skill's *full* body by name at invocation time, not just the
name+description enumerated in the prompt. For skills found via `config.skillPaths` that's
a plain file read; for the bundled `cli-tools` skill there's no on-disk file in a compiled
binary. Proposed two options in `docs/handoffs/prompt-docs.md`'s status log (Core
special-cases builtins, or the agent loop pre-resolves builtin skill content some other
way) — check whether Core resolved this before assuming it's still open.

**Deferred, not done:** logo/wordmark, skills beyond `cli-tools`, a generated (vs.
hand-maintained) `dh.json` reference in the README.

### 2026-07-15 — Round 2: tool-call fire-and-forget discipline point

Added a sixth "Working discipline" bullet to `BASE_PROMPT` in `src/prompt/system-prompt.ts`:
**a tool call is never fire-and-forget** — named `Monitor`/`TaskOutput` explicitly as the
required follow-up action, and stated the failure mode negatively ("ending your turn right
after... is a failure") to match the exact behavior real testing observed in small/local
models (starting a backgrounded Bash call, then ending the turn without ever checking the
result). Full text and rationale logged in `docs/handoffs/prompt-docs.md` Round 2 status
entry.

**Judgment call:** kept the bullet in the same terse, bolded-phrase style as the other five
rather than a longer explainer — the handoff was explicit that burying this in a long
paragraph risks a small model missing it. Named the tools by name so the model has a
concrete action, not just an abstract obligation.

**Honesty note carried forward:** this is a prompt-text change, not a live-verified
behavioral fix — no way to test against an actual local model session from this
environment. Worth revisiting if someone later runs the same LM Studio test setup against
the updated prompt and can report back whether the polling behavior actually improved.

Gates (`typecheck`, `lint`, `test:coverage`) all pass, 100% coverage retained on
`src/prompt/system-prompt.ts`.

### 2026-07-15 — Round 3: TASK_FAILED convention + polling cadence

Closed two gaps an architect-level review (Fable) found: `TASK_FAILED` (the marker
`src/agent/loop.ts` scans for to detect self-reported failure, per ADR 0006's exit-code
contract) had never actually been taught to the model in the prompt — only implemented in
detection code. Added a "Report failure with `TASK_FAILED`" bullet to `BASE_PROMPT` stating
it as a hard requirement, with the success/failure semantics spelled out explicitly (no
marker + no tool call = success; marker = failure; never emit it on success). Also added a
"Pace your polling" bullet for the predictable next failure mode after Round 2's
fire-and-forget fix: telling a model to check back doesn't say how often, so it now spells
out do-other-work-or-wait-a-reasonable-interval, don't-tight-loop-Monitor.

**Judgment call:** put the polling-cadence bullet immediately after the fire-and-forget
bullet and had it explicitly reference "not too fast" so the two read as complementary
(check back — but don't spin) rather than in tension. Kept `TASK_FAILED` as its own bullet
rather than folding it into an existing one, since it's a distinct mechanism (final-response
text convention) from the tool-call-discipline bullets around it.

**Honesty note carried forward again:** still no way to behaviorally verify either addition
against a live small-model session from this environment — flagging as before rather than
overclaiming test coverage of prompt-text effectiveness.

Gates: `typecheck` and `test:coverage` pass (693/693 tests, 100% coverage on
`system-prompt.ts`). `lint` has one pre-existing failure on an untracked root `dh.json`
unrelated to `src/prompt/` — not touched, out of scope.

### 2026-07-15 — Round 4: README Bedrock setup section

Routed over from E2E's Round 5 (they built real Bedrock e2e coverage and flagged the README
only had a one-line sample config entry, no operator-facing setup guidance). Added an "AWS
Bedrock setup" subsection to `README.md` covering `provider.region`, the standard AWS
credential chain (env vars, `~/.aws/credentials`/`config`, instance/container roles — `dh`
does no custom credential handling), `ProviderError`-wrapped error surfacing (same shape as
Anthropic), and a practical note that Bedrock model ids are region/account-specific and a
seemingly-valid id can still be legacy/deprecated, so "invalid model"/"access denied" errors
are usually account-side, not a `dh` config bug. Full text and placement rationale in
`docs/handoffs/prompt-docs.md` Round 4 status entry.

Docs-only, no code gates apply this round.
