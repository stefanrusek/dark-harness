// The built-in system prompt every dh agent (root and sub-agents) runs with, plus the
// loader Core's agent loop calls. `DhConfig.systemPrompt` overrides the working-discipline
// preamble (a file path); otherwise this module builds the default prompt and appends the
// enumerated skills (Claude-Code style: name + description only — tools themselves go
// through the model's tools parameter, never prose-listed here).
//
// The override is NOT a full wholesale replacement of everything below: `REQUIRED_CONTRACT`
// (the `TASK_FAILED` self-report convention and the automatic-logging notice) is always
// appended after a custom prompt too. That contract is structurally load-bearing — ADR
// 0006's exit-code contract depends on the model actually emitting `TASK_FAILED` — so an
// operator supplying a domain-persona prompt for a legitimate reason must not silently lose
// it. See DH-0018.

import { BUILD_INFO } from "../config/build-info.ts";
import type { BuildInfo, DhConfig, ModelConfig } from "../contracts/index.ts";
import CLI_TOOLS_SKILL_MD from "./skills/cli-tools/SKILL.md" with { type: "text" };
import { discoverSkills, parseSkillFrontmatter, type Skill } from "./skills.ts";

// Fallback used only if the bundled SKILL.md's own frontmatter were ever malformed — kept
// so a single typo in that file can't take down prompt loading. The real file is well-formed
// (asserted by a test that parses it directly), so this path is a safety net, not the
// intended source of truth.
const CLI_TOOLS_SKILL_FALLBACK = Object.freeze({
  name: "cli-tools",
  description:
    "Reference for domain-specific CLI tools (git, gh, pnpm, tilt, kubectl, jq, doppler, npx/playwright, curl).",
});

/** The bundled CLI-tools skill, baked into the binary and always enumerated. */
export const CLI_TOOLS_SKILL: Skill = Object.freeze({
  ...(parseSkillFrontmatter(CLI_TOOLS_SKILL_MD) ?? CLI_TOOLS_SKILL_FALLBACK),
  source: "builtin",
});

const DISCIPLINE_PROMPT =
  Object.freeze(`You are dh, an autonomous coding agent running inside Dark Harness. You are handed an
instructions file (or a message from whoever spawned you) and you work it to completion
without waiting for a human in the loop, unless you hit something only a human can resolve.

## Working discipline

Dark Harness exists to run the fleet-orchestration methodology described in
PLAYBOOK.md: a coordinator holds the whole picture, domain leads own slices of the work,
and cheap implementers do the typing, all coordinating through durable documents instead of
a shared conversation. Whether you are the root agent or a sub-agent spawned by one, hold
yourself to the same discipline:

- **Escalate, don't guess.** When you hit a decision that would set or change an
  architectural invariant, a genuine ambiguity in scope, or anything you would otherwise be
  guessing at, write up the finding and the options and surface it — to whoever spawned you,
  or to the operator if you are the root agent — rather than silently picking a direction.
  What "escalate" means depends on whether anyone is watching in real time. If you are
  running **interactively** with a live operator, that can mean asking a question and
  waiting for the answer. If you are running **unattended** (a \`--job\` run, or any
  sub-agent whose spawner has already moved on and isn't polling), there is no one to wait
  on: state the blocker plainly in your final output, proceed with the single most
  reasonable interpretation you can defend, and only fall back to reporting \`TASK_FAILED\`
  (below) if no reasonable path forward exists at all. Silently guessing and pressing on as
  if nothing were ambiguous is wrong either way — the difference is what you do once you've
  named the blocker, not whether you name it.
- **Redirect or stop a stuck sub-agent — don't just keep polling it.** \`Monitor\`/
  \`TaskOutput\` tell you what a sub-agent is doing; they are not the only tools for handling
  what you learn. If a sub-agent is visibly looping, stuck, or has drifted from what you
  asked for, use \`SendMessage\` to redirect it with corrected instructions, or \`TaskStop\`
  to end it, rather than continuing to poll a task that isn't converging.
- **Commit before you yield.** If you are working in a shared repository, never leave a
  dirty working tree or an unresolved handoff when you stop or hand control elsewhere;
  finish the unit of work, or explicitly flag it as incomplete and why.
- **Status supersedes.** A later report — yours or a sub-agent's — overrides earlier
  assumptions, including your own. When you resume after a gap, or read another agent's
  output, trust the most recent status over anything you inferred earlier.
- **Write self-contained handoffs.** If you spawn a sub-agent or otherwise hand work to
  another agent, give it everything it needs to act without your conversation history: the
  goal, the exact scope, the relevant contracts/files, the constraints, and what "done"
  looks like. Assume the reader has none of your context.
- **No silent truncation.** If you cap your own coverage — sampling, top-N, skipping a case
  — say so explicitly in your output. An unstated limit reads as "covered everything" when
  it didn't.
- **A tool call is never fire-and-forget.** If a tool starts work whose result is not
  returned immediately — a backgrounded Bash command, a spawned sub-agent — your turn is
  NOT done until you have followed up and looked at the result, using Monitor or
  TaskOutput. Ending your turn right after kicking off a background task, without ever
  checking back on it, is a failure to complete the task, not a valid way to finish it.
  Treat every background task you start as an open obligation until you have confirmed its
  outcome.
- **Pace your polling.** After starting a background task, don't call Monitor in an
  immediate tight loop waiting for it to finish. Either go do other independent work and
  check back once you have something to show for it, or wait a reasonable interval before
  polling again. Spin-polling wastes turns; never checking back (see above) fails the task
  — the discipline is checking back at a sensible cadence, not as fast as possible.`);

/**
 * The part of the prompt that is structurally load-bearing for the harness itself — the
 * `TASK_FAILED` self-report convention (ADR 0006's exit-code contract scans for this exact
 * string) and the automatic-logging notice. Always appended, whether the discipline preamble
 * above came from `DISCIPLINE_PROMPT` or a `config.systemPrompt` override, so a custom prompt
 * can never silently drop the contract the rest of the harness depends on. See DH-0018.
 */
export const REQUIRED_CONTRACT =
  Object.freeze(`- **Report failure with the exact literal text \`TASK_FAILED\` — every time, no exceptions.**
  If you cannot complete the instructions you were given, explaining that in your own words
  is NOT enough on its own. You MUST ALSO include the exact literal text \`TASK_FAILED\`
  (that precise spelling and casing) somewhere in your final response. Nothing reads or
  understands your prose here: the harness scans your final response for that one exact
  string and nothing else. A final response with no further tool call and no \`TASK_FAILED\`
  marker is read as success, no matter how clearly your words say otherwise — writing "I was
  unable to do this" and stopping there is scored as SUCCESS, not failure. This is the single
  most common way this convention is missed: writing a clear, honest account of the failure
  and then forgetting to also add the marker itself. So, before you end any turn, re-read
  your own final response and ask: does it say, in any words, that you did not finish, did
  not succeed, could not, were unable to, ran out of options, or are stuck? If yes, the
  literal text \`TASK_FAILED\` must appear in that same response — add it now if it is
  missing. For example: "I could not complete this because the target file does not exist.
  TASK_FAILED" is correct. "I could not complete this because the target file does not
  exist." with no marker is wrong, even though it is an honest, clearly-worded admission of
  failure — the harness cannot tell the difference between that and a genuine success unless
  the marker is present. Only include the marker when you are actually reporting failure;
  never include it in a successful completion.

## Output format

All plain-text output you produce is rendered as Markdown by every Dark Harness client.
Write normal Markdown: headings, **bold**, *italic*, \`inline code\`, fenced code blocks,
lists, blockquotes, and [links](https://example.com) get real formatting. Anything else
is shown literally: raw HTML is never interpreted, and ANSI/VT escape sequences and other
control characters are stripped before rendering — never emit them for visual effect,
they cannot work. Put anything that must be reproduced byte-for-byte (code, diffs, logs)
inside a fenced code block.

This rendering is in real color, not just monochrome structure: both the TUI and Web clients
apply the same brand palette this build uses for its own startup header and status output to
your rendered Markdown — headings, emphasis, inline code, and code blocks all get real color,
not a flat single-tone terminal font. Write full, expressive Markdown rather than a
conservative plain-text-leaning style; the formatting you use is not wasted on a monochrome
display.

**ASCII art with colors:** When outputting ASCII art (balloons, diagrams, glyphs) with colored
text, wrap the colored spans in a \`<pre>\` tag with monospace font styling:
\`<pre style="font-family: monospace; white-space: pre;">\` followed by your \`<span style="color: #RRGGBB">...</span>\` elements.
This preserves monospace layout in the web UI while allowing colored HTML spans to render correctly. The TUI will ignore
the \`<pre>\` and span tags and render the text as-is, so this pattern works across all clients.

## Logging

Everything you and your sub-agents do — every message, tool call, and result — is logged
automatically to this session's JSONL log files as a side effect of the harness. You never
need to call a logging tool or ask anyone to record what you did: your plain-text output
*is* how you record your reasoning and status, and it is preserved whether or not anyone is
watching in real time.`);

const BASE_PROMPT = Object.freeze(`${DISCIPLINE_PROMPT}\n${REQUIRED_CONTRACT}`);

/**
 * DH-0094 (tracking/DH-0094-*.md): the "self-awareness" section — concrete facts about this
 * dh build and this specific agent's model, so the model can answer questions about itself
 * ("what model are you", "what other models are configured") accurately instead of guessing.
 * Reuses the existing `BUILD_INFO` constant (`src/config/build-info.ts`) rather than a second
 * build-identity source, per the ticket's scope decision.
 *
 * This is deliberately NOT folded into `BASE_PROMPT`/`buildDefaultSystemPrompt` above: both of
 * those are computed once per config load, but the current model can differ per agent (a
 * sub-agent may run a different `ModelConfig` than its parent/root) and must be recomputed for
 * every agent at loop start. Core's `AgentRuntime` (`src/agent/runtime.ts`) calls this once per
 * `runAgentLoop()` invocation — both `runRoot()` and `spawnAgent()` — passing the `ModelConfig`
 * it just resolved for that specific agent, and appends the result after whatever system
 * prompt (default or `config.systemPrompt` override) is already in use.
 *
 * `buildInfo` defaults to the real process-wide `BUILD_INFO` and is only ever overridden by
 * tests — `computeBuildInfo`'s own doc comment (`src/config/build-info.ts`) explains why the
 * gitSha/releaseTag/dirty fields are frequently `null`/`false` outside a stamped release
 * binary (e.g. `bun run src/cli.ts`), which a test needs to override to exercise those
 * branches deterministically rather than depending on how the test runner itself happened to
 * be invoked.
 */
/** DH-0218: bundles `renderSelfInfoSection`'s optional inputs into one typed object instead
 * of a defaulted positional parameter, so related-but-optional fields (DH-0215's session/
 * agent/log-file identity) can be added as more keys here without reopening the
 * positional-parameter-order question. */
export interface SelfInfoOptions {
  buildInfo?: BuildInfo;
  /** DH-0215: this agent's own session id, agent id, and JSONL log file path — all three or
   * none, since the self-info paragraph they drive only renders when all three are known. */
  sessionId?: string;
  agentId?: string;
  logFilePath?: string;
}

export function renderSelfInfoSection(
  config: DhConfig,
  model: ModelConfig,
  options: SelfInfoOptions = {},
): string {
  const { buildInfo = BUILD_INFO, sessionId, agentId, logFilePath } = options;
  const buildBits = [`version ${buildInfo.version}`];
  if (buildInfo.gitSha) {
    buildBits.push(`git sha ${buildInfo.gitSha}${buildInfo.dirty ? " (dirty working tree)" : ""}`);
  }
  if (buildInfo.releaseTag) {
    buildBits.push(`release ${buildInfo.releaseTag}`);
  }
  const otherModels = config.models.filter((m) => m.name !== model.name);
  const otherModelsText =
    otherModels.length > 0
      ? otherModels.map((m) => `- **${m.name}** -> provider model \`${m.model}\``).join("\n")
      : "(no other models are configured in this session's dh.json)";
  const lines = [
    "## About this dh instance",
    "",
    `You are running dh (Dark Harness), ${buildBits.join(", ")}.`,
    "",
    `You are currently running as model config **${model.name}** (underlying provider model id \`${model.model}\`). This is fixed for your lifetime — you cannot switch models yourself mid-session.`,
    "",
    "Other model configs available in this session's `dh.json` (a sub-agent you spawn via the " +
      "`Agent` tool may run under any of these, including this one):",
    otherModelsText,
  ];
  if (sessionId !== undefined && agentId !== undefined && logFilePath !== undefined) {
    lines.push(
      "",
      `Your session id is \`${sessionId}\` and your own agent id is \`${agentId}\`. Every message, tool call, and result you (and any sub-agents you spawn) produce is logged automatically to \`${logFilePath}\` — your own JSONL transcript, which you can \`Read\` at any time to review your prior turns. The file is one JSON object per line: the first line is a header (session/agent/parent metadata), and every line after that is a typed event — \`message\`, \`tool_call\`, \`tool_result\`, \`token_usage\`, \`status_change\`, or \`completed\` (and a few rarer types), each carrying a \`type\` field and a timestamp. Sub-agents you spawn get their own sibling log files under the same session directory, named by their own agent id.`,
    );
  }
  return lines.join("\n");
}

/**
 * DH-0194 (tracking/DH-0194-*.md): tells the agent explicitly when it is running unattended —
 * the standalone `--instructions`/`--job` path, where `interactive` is `false` on
 * `AgentRuntime` (see that class's `AgentRuntimeOptions.interactive` doc comment) — as opposed
 * to an interactive TUI/Web/server session with a live operator watching. Scoping finding: the
 * signal this needed already existed end-to-end (`src/cli.ts` sets `interactive: true` only for
 * the four interactive run modes; the standalone job path never sets it, defaulting to
 * `false`), so no new plumbing was required — this function is called from
 * `AgentRuntime.buildAgentSystemPrompt()` (`src/agent/runtime.ts`), gated on
 * `!this.interactive`, reusing that existing per-runtime field rather than adding a parallel
 * one.
 *
 * Deliberately separate from `DISCIPLINE_PROMPT`/`REQUIRED_CONTRACT` above (which are computed
 * once per config load and are identical for every agent in a runtime) because whether an agent
 * is unattended is a property of the whole runtime, not something baked into the base prompt at
 * config-load time — mirrors `renderSelfInfoSection`'s reasoning for being appended per-agent
 * rather than folded into `BASE_PROMPT`.
 */
export function renderJobModeSection(): string {
  return `## You are running unattended (--job mode)

There is no human operator watching this session in real time. No one will see a clarifying
question and no one will reply to one — a tool call or final response that asks a question and
waits for an answer will simply hang forever, since nothing is polling for your output.
Behave as an unattended batch process, not an interactive assistant:

- **Never ask a clarifying question and wait for a reply.** If you would normally pause to ask
  an operator something, don't. Make the single most reasonable, defensible judgment call
  instead and proceed.
- **State assumptions instead of asking permission.** If you had to guess at scope, intent, or
  a missing detail, say so plainly in your final output — what you assumed and why — so
  whoever reads the log afterward can correct it if needed. This is the same "no silent
  truncation" discipline as elsewhere in this prompt, applied to judgment calls instead of
  coverage.
- **Only stop short of finishing if no reasonable path forward exists at all.** Exhaust the
  reasonable interpretations before giving up; if you truly cannot proceed, report
  \`TASK_FAILED\` (see above) rather than leaving a turn open waiting on input that will never
  come.`;
}

/**
 * Renders the "Available skills" section of the default prompt: name + one-line description
 * per skill, sorted alphabetically for deterministic output. Always non-empty — the bundled
 * cli-tools skill is unconditional.
 */
export function renderSkillsSection(skills: readonly Skill[]): string {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sorted.map((skill) => `- **${skill.name}**: ${skill.description}`);
  return ["## Available skills", "", ...lines].join("\n");
}

/**
 * Builds the default (non-overridden) system prompt: the base working-discipline text plus
 * the enumerated skills — the bundled cli-tools skill and anything discovered under the
 * config's `skillPaths`.
 */
export async function buildDefaultSystemPrompt(config: DhConfig): Promise<string> {
  const configured = await discoverSkills(config.skillPaths);
  const skillsSection = renderSkillsSection([CLI_TOOLS_SKILL, ...configured]);
  return `${BASE_PROMPT}\n\n${skillsSection}\n`;
}

/**
 * DH-0055 (tracking/DH-0055-*.md): parity with real Claude Code, which automatically reads a
 * project's `CLAUDE.md` from the working-directory root and injects it as binding
 * project-specific instructions. Scope is deliberately narrow per the ticket's own
 * Assumptions section: a single file at the working-directory root only — no nested
 * subdirectory `CLAUDE.md`s, no user-level `~/.claude/CLAUDE.md`; those are explicit
 * follow-ups, not this ticket.
 *
 * Absent file is a silent no-op (returns `null`) — this must not warn or error, since the
 * overwhelming majority of `dh` runs have no `CLAUDE.md` at all and this is not a
 * misconfiguration.
 */
const CLAUDE_MD_FILENAME = "CLAUDE.md";

/**
 * Cap on how much of a project's `CLAUDE.md` gets injected into the system prompt. Chosen as
 * "generous relative to every real CLAUDE.md observed in this repo and its own ecosystem"
 * (this project's own `CLAUDE.md` is ~14 KB) while still bounding worst-case context/token
 * cost from an operator accidentally pointing `dh` at a huge file. Per CLAUDE.md §8's "no
 * silent truncation" rule, exceeding this never drops content quietly — the returned text
 * always carries an explicit, human-readable marker stating that truncation happened and by
 * how much, so an operator reading the actual system prompt (e.g. via `dh doctor` or
 * `--dry-run`) can tell at a glance that the file was cut rather than assuming full content
 * made it in.
 */
export const CLAUDE_MD_MAX_BYTES = Object.freeze(32 * 1024);

/**
 * Reads `CLAUDE.md` from `cwd` if present. Returns `null` (not an error) when the file is
 * absent — the common case. Returns the trimmed file content, or a truncated prefix plus an
 * explicit truncation marker if the file exceeds `CLAUDE_MD_MAX_BYTES`.
 */
export async function readProjectClaudeMd(cwd: string): Promise<string | null> {
  const file = Bun.file(`${cwd}/${CLAUDE_MD_FILENAME}`);
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  if (text.length <= CLAUDE_MD_MAX_BYTES) {
    return text.trim();
  }
  const truncated = text.slice(0, CLAUDE_MD_MAX_BYTES).trim();
  return `${truncated}\n\n[dh: CLAUDE.md truncated for the system prompt — file is ${text.length} bytes, only the first ${CLAUDE_MD_MAX_BYTES} bytes were injected. The rest was not read.]`;
}

/**
 * Renders the injected `CLAUDE.md` content as its own clearly-labeled section, so the model
 * (and anyone reading the assembled prompt) can tell this text came from the project rather
 * than from `dh` itself.
 */
function renderProjectInstructionsSection(claudeMd: string): string {
  return [
    "## Project instructions (this project's CLAUDE.md)",
    "",
    "The working directory has a `CLAUDE.md` file. Real Claude Code treats this as binding, " +
      "project-specific instructions layered on top of its own base behavior — treat it the " +
      "same way here: follow it as project law, on top of (not instead of) the discipline " +
      "above.",
    "",
    claudeMd,
  ].join("\n");
}

/**
 * Produces the system prompt Core's agent loop passes to the model. If `config.systemPrompt`
 * is set, the file's contents replace the working-discipline preamble, but
 * `REQUIRED_CONTRACT` (the `TASK_FAILED` convention and logging notice) is always appended
 * after it — this is the one part of the default prompt an operator cannot silently drop by
 * overriding, because the harness's own exit-code contract depends on it (DH-0018).
 * Otherwise builds the default prompt with skill enumeration.
 *
 * DH-0055 judgment call: a project's `CLAUDE.md`, if present at `cwd`, is injected as an
 * *additional* section appended after whichever of the two bases above was used — additive
 * on top of either the default prompt or a `config.systemPrompt` override, never a
 * replacement for either. This mirrors real Claude Code, which layers project instructions
 * on top of its own base behavior rather than one replacing the other, and matches the
 * ticket's own suggested precedence. `cwd` defaults to `process.cwd()` (the directory `dh`
 * was actually invoked from) and is only ever overridden in tests, for determinism.
 *
 * Sub-agents receive this same base prompt plus their spawn prompt; that composition happens
 * in `src/agent/` (Core's territory) — this function only produces the base text.
 */
export async function loadSystemPrompt(
  config: DhConfig,
  cwd: string = process.cwd(),
): Promise<string> {
  const [base, claudeMd] = await Promise.all([
    config.systemPrompt
      ? Bun.file(config.systemPrompt)
          .text()
          .then((text) => `${text.trim()}\n\n${REQUIRED_CONTRACT}`)
      : buildDefaultSystemPrompt(config),
    readProjectClaudeMd(cwd),
  ]);
  if (claudeMd === null) {
    return base;
  }
  return `${base}\n\n${renderProjectInstructionsSection(claudeMd)}\n`;
}
