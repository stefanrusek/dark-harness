# Roster: Iris — Prompt domain lead

**Pronouns:** she/her
**Role:** Prompt domain lead
**Persistence:** persistent
**Owns:** `src/prompt/`, `README.md`
**Handoffs:** `docs/handoffs/prompt-docs.md`

## Memory

### 2026-07-19 — DH-0228: GitHub social-preview card

Built `docs/media/social-preview.svg` (1280×640, near-black `#0b0d12`), embedding the real
`logo.svg` monogram path geometry + `dhGradient` (unrecolored) via
`<g transform="translate(200,175) scale(0.78125)">`, the "Dark Harness" wordmark, the DH-0227
tagline ("Unattended multi-agent harness in a single binary."), and a recessive agent-node
motif in the corners — exactly per Muriel's coordinate-level spec, no design judgment calls
left. Rasterized with headless Chromium via a new `docs/media/social-preview.render.ts`
(reuses `e2e/support/chromium.ts`'s resolver, same pattern as `hero-web-dark.png`'s capture
script) rather than a local SVG rasterizer, specifically to dodge font substitution — Chromium
brings its own web-safe grotesque sans. Output confirmed exactly 1280×640 px, 35 KB.

**Convention worth remembering:** static docs/media assets that need deterministic rendering
(fonts, gradients) should render via headless Chromium + Playwright, not a local
`resvg`/`rsvg-convert` binary whose font availability varies by machine — same lesson
DH-0068's hero-screenshot capture already established, now applied to a second asset type
(SVG-to-PNG, not live-app screenshot).

**Test:** `src/prompt/social-preview.test.ts` — asserts PNG IHDR is 1280×640 and the SVG
contains the logo's exact bowl path data, both gradient stops, the background fill, and the
wordmark text. Full gates (typecheck/lint/test:coverage/e2e) all green. A concurrent session
was landing DH-0227 (README hero reorder) at the same time touching `README.md` and
`src/prompt/readme-config-sync.test.ts` — left those files' uncommitted state untouched and
committed only DH-0228's own files, per CLAUDE.md's directory-ownership collision-avoidance
guidance. Ticket moved to `verifying`; owner still needs to manually upload the PNG via
GitHub Settings → General → Social preview (out of ticket scope, flagged in ticket Notes).

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

### 2026-07-15 — Round 5: TASK_FAILED reliability (DH-0001)

Worked the ticket a coordinator/architect review raised: live testing against gemma-4-31b
showed the model writing a plain-English admission of failure but never emitting the
`TASK_FAILED` marker Round 3 taught, so `dh` reported exit code 0 for a self-acknowledged
failure. Strengthened the `TASK_FAILED` bullet in `BASE_PROMPT`
(`src/prompt/system-prompt.ts`): restated as "every time, no exceptions," named the exact
observed failure mode (write the honest paragraph, forget the token), added a worked
correct/incorrect example, and added a re-read-before-ending-your-turn self-check. Updated
`src/prompt/system-prompt.test.ts` assertions to match.

**Judgment call:** did not touch `src/agent/loop.ts`'s detection logic or propose a code
change to the self-report mechanism myself — the ticket's Open Question (whether ADR 0006's
exit-code contract needs a less string-dependent mechanism) is a real design question that
crosses into Core's territory and the exit-code contract, both named in CLAUDE.md §6 as
architect-review triggers. Escalated a concrete structural alternative (a mandatory
structured "report terminal outcome" tool call instead of free-text scanning) as a finding
in the ticket and in `docs/handoffs/prompt-docs.md`, rather than picking a direction
unilaterally from the Prompt domain.

**Honesty note carried forward, sharpened this round:** I have no way to re-run this against
a live small/local model from this environment, so I closed the loop on "make the prompt
stronger" but explicitly did NOT close the ticket — a stronger prompt is not proof the actual
reliability gap is gone, and the ticket's own Risk section already predicted this exact
limitation. Left `tracking/DH-0001-...md` at `status: implementing` with a status-log entry
explaining why, rather than marking it resolved on the strength of a text change I can't
behaviorally verify.

Gates: `typecheck`, `lint`, `test:coverage` all pass (806/806 tests, 100% coverage retained
on `src/prompt/system-prompt.ts`). `e2e` has pre-existing sandbox environment failures
(missing `tmux`, missing chromium binary) unrelated to this change.

### 2026-07-15 — Round 6: closed DH-0018, DH-0039, DH-0041, DH-0042

Worked four already-`implementing` Spile tickets to closed this round. Full detail in
`docs/handoffs/prompt-docs.md`'s Round 6 entry — durable notes here are the judgment calls
worth remembering on top of that.

**DH-0018 (systemPrompt override / discipline gaps):** split `BASE_PROMPT` into
`DISCIPLINE_PROMPT` (overridable) and an exported `REQUIRED_CONTRACT` const (`TASK_FAILED` +
Logging), and changed `loadSystemPrompt` to always append `REQUIRED_CONTRACT` after a custom
`config.systemPrompt` file's contents rather than treating the override as a full
replacement. Chose "always append" over "just warn" — strictly more robust, and testable in
a way a warning isn't. Also added interactive-vs-unattended language to the "escalate, don't
guess" bullet, and a new bullet naming `SendMessage`/`TaskStop` (not just `Monitor`/
`TaskOutput`) for handling a stuck sub-agent. Judged this as squarely inside Prompt's
ownership (prompt text + its own loader), not something needing architect sign-off, since it
doesn't touch `src/contracts/` or the exit-code detection logic itself — only guarantees the
existing string-based contract can't be silently dropped by config. Round 5's escalated
structural question (a `ReportOutcome`-style tool instead of string-scanning) is still open
and untouched.

**DH-0042 (README config gaps + drift check):** documented `options.maxTurns` and the
per-model pricing fields, and added `src/prompt/readme-config-sync.test.ts` — a
regex-based (not full-TS-parser) drift guard that fails `bun test src` if a `DhOptions`/
`ModelConfig` field goes unmentioned in README. Chose a test-suite check over a new CI
workflow: cheaper, runs everywhere the existing gate already runs, no CI/Release
coordination needed. Deliberately shallow (presence-only, not correctness) — said so in the
test file's own header so it's not mistaken for stronger validation later.

**DH-0039 / DH-0041 (doc-only):** verified every factual claim against actual source before
writing it down, not just the ticket summary — most notably for the MCP docs
(`docs/mcp-servers.md`): the config schema for `mcpServers` is real, but `src/agent/mcp.ts`
only returns a synthetic `ToolSearch` placeholder and `McpAuth` is a documented stub, so the
doc says that plainly instead of implying a working feature. Also cross-checked TUI
keybindings against `src/tui/state.ts`'s actual reducers rather than guessing, and the JSONL
log reference against `src/contracts/log.ts` directly (deferring to ADR 0005 as
authoritative if they ever disagree). Added `CHANGELOG.md`/`CONTRIBUTING.md` at repo root and
linked all nine new docs from a new README "Further documentation" section.

**Open thread carried forward:** none of this round's work touches the Round 5 escalation
(structural `TASK_FAILED` reliability fix) — still awaiting architect/coordinator judgment,
untouched by this round's changes.

Gates: `typecheck`, `lint`, `test:coverage` all pass (809/809 tests, 100% coverage retained
across `src/prompt/`). `e2e` not run this round — unrelated to scope, same pre-existing
sandbox gaps (no `tmux`/chromium) as prior rounds.

### 2026-07-15 — DH-0056 (Output format / Markdown contract)

Added a new "## Output format" section to `REQUIRED_CONTRACT` in `src/prompt/system-prompt.ts`,
placed between the `TASK_FAILED` bullet and `## Logging` per Fable's D6 design — same
DH-0018 rationale (survives a custom `systemPrompt` override, since clients parse Markdown
unconditionally regardless of any operator persona prompt). Used the wording suggested in
the ticket verbatim. Added matching assertions to `system-prompt.test.ts` (default-prompt
inclusion, `REQUIRED_CONTRACT`'s own content, and an override-still-gets-it case), plus a
short README note (new paragraph after the JSONL-logging paragraph in "Tools, skills, and
sub-agents") that agent output renders as Markdown in both TUI and Web clients. This is
Prompt's whole piece of DH-0056 — the shared `src/markdown/` parser (Mary), TUI renderer
(Mary), Web renderer (Susan), and E2E hostile-bytes coverage (Hedy) are separate,
independent pieces per the ticket's D7 sequencing table; nothing here depends on them
landing first.

Gates: `typecheck`, `lint`, `test:coverage` all pass (957/957 tests, 100% coverage retained
project-wide, including `src/prompt/`). `e2e` not run — unrelated to scope, same
pre-existing sandbox gaps as prior rounds.

### 2026-07-16 — DH-0094: self-awareness section in the system prompt (joint with Core/Grace)

Added `renderSelfInfoSection(config, model, buildInfo = BUILD_INFO)` to
`src/prompt/system-prompt.ts`: concrete self-facts (dh version/git sha/dirty flag/release tag
from `BUILD_INFO`, the current agent's model config name + provider model id, and the other
model names configured in `dh.json`) instead of the vague hedging the ticket's live-testing
finding called out. Deliberately NOT folded into `BASE_PROMPT`/`buildDefaultSystemPrompt` —
those are computed once per config load, but the current model differs per agent (a
sub-agent may run a different `ModelConfig` than its parent), so it has to be a separate,
per-agent-callable function. `buildInfo` is an injectable third param (default `BUILD_INFO`)
purely for test determinism — `computeBuildInfo`'s own doc comment explains gitSha/releaseTag
are usually null outside a stamped release binary, so a test needs to override them to
exercise those branches. Wiring into the actual per-agent loop call (appending this section
after Core's `this.systemPrompt` at both `runRoot()` and `spawnAgent()` call sites) is
Core/Grace's piece — see her roster note same date.

Noted but out of scope: `src/cli.ts` has its own local `loadSystemPrompt`/
`DEFAULT_SYSTEM_PROMPT` placeholder that never calls `src/prompt/system-prompt.ts`'s real
`loadSystemPrompt`/`buildDefaultSystemPrompt` — the default system prompt actually shipped by
`dh` today is still the `TODO(prompt domain)` placeholder text, not Iris's real discipline
prompt/skills enumeration. This DH-0094 self-info section still reaches the model regardless
(it's appended independently of what base prompt is in use), so it isn't blocked by that gap,
but the gap itself is real and pre-existing — flagging for the coordinator to file separately
rather than silently expanding this ticket's scope.

Gates: `typecheck`/`lint` clean. `test:coverage`: 1668 pass, 0 fail; `src/prompt/
system-prompt.ts` and `src/agent/runtime.ts` both 100% lines/funcs. `e2e`: 30/32 pass, same
pre-existing headless-Chromium-unavailable-in-sandbox failures every prior round has
footnoted, unrelated to this change. Closed DH-0094 (`transition.py DH-0094 closed
--resolution done`).

### 2026-07-16 — DH-0055: CLAUDE.md project-instructions parity (joint with Core/Grace)

Real Claude Code auto-reads a project's `CLAUDE.md` and injects it as binding
project-specific instructions; `dh` had no equivalent. Added `readProjectClaudeMd(cwd)` and
`renderProjectInstructionsSection()` to `src/prompt/system-prompt.ts`, and wired both into
`loadSystemPrompt(config, cwd = process.cwd())`. This landed entirely inside Prompt's own
module — the call site (`src/cli.ts`'s `deps.loadSystemPrompt(config)`) already invokes this
once at startup with `process.cwd()` as the implicit default, so no Core wiring was needed
this round (see judgment call below on why the ticket's "Core config-loading" framing turned
out not to require a Core-owned code change).

**Judgment calls (both explicitly invited by the ticket):**
- **Precedence:** CLAUDE.md is always *additive*, appended after whichever base is in use —
  the built-in default prompt (after the skills section) or a `config.systemPrompt`
  override (after `REQUIRED_CONTRACT`) — never a replacement for either. Mirrors real Claude
  Code layering project instructions on top of its own base behavior.
- **Size cap:** 32 KiB (`CLAUDE_MD_MAX_BYTES`), generous relative to this repo's own
  `CLAUDE.md` (~14 KB) observed in practice. Exceeding it truncates but always appends an
  explicit marker naming the actual file size and the cap, per CLAUDE.md §8's "no silent
  truncation" rule — never a quiet drop.
- **Absent file:** `readProjectClaudeMd` returns `null`, a true no-op — no warning, since the
  overwhelming majority of `dh` runs have no `CLAUDE.md` and this isn't misconfiguration.
- **Scope:** single file at the working-directory root only, per the ticket's own
  Assumptions section — no nested/subdirectory or `~/.claude/CLAUDE.md` handling, explicit
  follow-up if ever wanted.

**Test-isolation gotcha worth remembering:** `loadSystemPrompt`'s new `cwd` parameter
defaults to `process.cwd()`, and this repo's own root now *has* a `CLAUDE.md` (this very
file) — any test that calls `loadSystemPrompt(config)` without an explicit `cwd` while the
test runner's cwd is the repo root will pick it up. Two existing `src/cli.test.ts` real-fs
tests hit exactly this and needed a `process.chdir(dir)`/restore wrapper (same pattern
already used elsewhere in that file) to stay isolated. Anyone adding a new
`loadSystemPrompt` test without overriding `cwd` should watch for this.

**Live verification (not just prompt-string assertions):** built the real binary, wrote a
scratch project's `CLAUDE.md` with a distinctive instruction ("always end every response
with the literal string CLAUDE_MD_LOADED_OK"), ran `dh --instructions ... --job` against a
local mock Anthropic-compatible SSE provider (the real `AnthropicProvider` adapter now
streams — see the concurrent DH-0044 note below), and confirmed both that the captured
system prompt sent over the wire contained the CLAUDE.md text *and* that the model's actual
reply was `Task complete. CLAUDE_MD_LOADED_OK` — proof the injected content reached and was
acted on by a live model call, not just that the prompt string contains it.

**Noted, not mine to fix:** a concurrent, uncommitted round (DH-0044) had switched
`src/agent/providers/anthropic.ts` to a streaming (`stream: true`, SSE-parsed) request/
response shape mid-session — my first verification attempt used a non-streaming mock and got
a silently-empty `finalOutput` until I rewrote the mock to emit the real SSE event sequence
(`message_start`/`content_block_start`/`content_block_delta`/.../`message_stop`). Left that
provider work entirely untouched; flagging here only so a future reader isn't confused by why
the verification script needed the SSE shape.

Gates: `typecheck`/`lint` clean on `src/prompt/system-prompt.ts` and `src/cli.test.ts` (the
only files this round touched — a large concurrent set of other files was dirty at both
start and end of this round from unrelated in-flight background rounds per `git status`,
left untouched). `bun test src/prompt src/cli.test.ts --coverage`: `src/prompt/
system-prompt.ts` 100%/100% lines+funcs; 215 pass, 2 pre-existing fail (both in the
`AgentRuntimeLoopAdapter` streaming-adapter suite, caused by that same concurrent DH-0044
change, unrelated to this ticket). Closed DH-0055 (`transition.py DH-0055 closed
--resolution done`).

### 2026-07-19 — DH-0227: README hero restructure (screenshot above the fold)

Owner design feedback ahead of showing the project around: the product screenshot sat below
a title, badges, two paragraphs, and a 25-line "Why this exists" essay — below the fold on
every viewport. Muriel (design crew) specced the fix in `docs/design/style-guide.md` §8
(new "README / repo-front conventions" section, added same pass): first-screenful order is
mark → name → one-line tagline → badges → product shot, long-form rationale below. Pure
reorder, no new content, per the ticket's explicit FR-5.

Reordered `README.md`: logo → `# Dark Harness` → new one-line centered tagline (the first
clause of the old multi-line bold hook, "Point `dh` at a repo and an instructions file, and
it works the job unattended.") → badges → the existing hero `<picture>` block + caption
(verbatim, srcset/alt/caption untouched). The "No daemons…" paragraph, the rest of the
original hook sentence, and the "### Why this exists" essay now sit below the screenshot.

**Judgment call:** the original hook was one sentence split by an em dash — extracting the
first clause as the tagline (per FR-2's exact wording) left a dangling fragment for the
remainder. Rejoined it below the fold as "It's a single compiled binary running an LLM
agent…" — the only wording delta from the source text, and a minimal one needed to keep the
demoted remainder grammatical after the split the ticket itself specified.

Added a block-order regression test to `src/prompt/readme-config-sync.test.ts` (same file
DH-0042 established as the README-drift-guard home): asserts the hero `<picture>` block's
byte offset is less than both the `### Why this exists` heading's and the "No daemons to
install" paragraph's offsets, so a future edit can't silently re-bury the screenshot. This
is the durable convention now cited by `docs/design/style-guide.md` §8 for any future README
edit.

**Not mechanically tested (per the ticket's own acceptance-criteria note):** the "tagline
fits in one line at GitHub's default column width" bullet is a visual property — flagged for
the owner to eyeball on the rendered page, not something this test suite can check.

Gates: `typecheck` clean; `test:coverage` 146/146 pass (100% on the two changed files);
`e2e` 41/41 pass. `lint` has one pre-existing, unrelated failure in
`docs/media/social-preview.render.ts` (DH-0228's file, not touched this round). Moved
DH-0227 to `verifying` — implementation done, dated Notes entry added to the ticket; not
mine to close since a Prompt/design ticket's close-out is the coordinator's call per
CLAUDE.md §8.
