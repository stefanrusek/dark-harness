---
spile: ticket
id: DH-0016
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0016: The bundled `cli-tools` skill is unreachable via the `Skill` tool, plus several other skill-system gaps

## Summary

The single most concrete finding (independently discovered by both the Core sweep and the Prompt
sweep): the bundled `cli-tools` skill's body is embedded at compile time as a string constant
(`src/prompt/system-prompt.ts`'s `CLI_TOOLS_SKILL_MD` import), but the `Skill` tool only loads from
`config.skillPaths` directories on disk (`src/agent/skills.ts`'s `loadSkillFromPaths`) — there is
no on-disk path matching `cli-tools` unless an operator coincidentally creates one. The system
prompt enumerates `cli-tools` as available and README says "no config needed for that one," but a
model calling `Skill(skill: "cli-tools")` gets a "no skill found" error. No test anywhere exercises
loading it, so this shipped uncaught. Related, smaller gaps in the same subsystem: skill discovery
keys by frontmatter `name` while loading keys by directory name, with no reconciliation (a
directory/frontmatter-name mismatch silently fails to load); no de-duplication of skill names
across `skillPaths` or against the builtin `cli-tools`; malformed/multi-line SKILL.md frontmatter
is silently dropped with zero operator-visible warning (inconsistent with the project's own
"no silent truncation" discipline); and skill names passed to `Skill` aren't checked for path
traversal (`../` segments), a minor issue given the "everything is allowed" permission model but
inconsistent with the tool's documented scope.

## User Stories

### As an agent, I want `Skill(skill: "cli-tools")` to actually load the bundled reference it was told is available

- Given the builtin `cli-tools` skill enumerated in the system prompt, when the `Skill` tool is
  called with that name, then its full body is returned, not a "not found" error.

### As a skill author, I want a directory/frontmatter name mismatch to fail loudly, not silently

- Given a skill directory whose name differs from its frontmatter `name`, when discovery/loading
  runs, then either the mismatch is reconciled automatically or a clear warning is surfaced.

### As a skill author, I want malformed SKILL.md frontmatter to produce a visible warning, not a silent omission

- Given a `SKILL.md` with unparseable frontmatter (e.g. a multi-line YAML block scalar), when
  discovery runs, then a warning is logged rather than the skill vanishing with no trace.

## Functional Requirements

- Given any skill name collision (two skills with the same name, or a configured skill named
  `cli-tools`), when the prompt is rendered, then the collision is resolved deterministically and
  documented, not silently double-listed.

## Notes

> [!NOTE]
> Source: Core domain sweep finding #12 (path traversal) and Prompt domain sweep findings #1
> (unreachable cli-tools — flagged as the sweep's top finding), #2 (name/directory mismatch), #3
> (no dedup), #4 (silent frontmatter-parse failures). This is a Core+Prompt cross-domain fix (per
> CLAUDE.md §6 trigger 3) since discovery lives in Prompt and loading lives in Core.
