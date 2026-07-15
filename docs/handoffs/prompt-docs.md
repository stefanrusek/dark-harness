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

_(Append dated entries here. Status supersedes.)_
