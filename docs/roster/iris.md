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
