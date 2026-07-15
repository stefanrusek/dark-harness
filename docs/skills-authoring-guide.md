# Writing a skill

`dh` discovers skills the same way Claude Code does: each directory listed in `dh.json`'s
`skillPaths` is scanned one level deep for subdirectories containing a `SKILL.md`
(`src/prompt/skills.ts`). Every discovered skill (plus the always-bundled `cli-tools` skill)
is enumerated by name and one-line description in the system prompt; an agent loads a
skill's full body on demand by name via the `Skill` tool.

## Minimum shape

```
my-skills/
  db-migrations/
    SKILL.md
```

```markdown
---
name: db-migrations
description: How to write and review database migrations in this repo — naming convention, backward-compat rules, how to test one locally before it ships.
---

# Writing a migration

... the actual instructional content the agent reads when it invokes this skill ...
```

## Frontmatter rules

`dh`'s frontmatter parser (`parseSkillFrontmatter` in `src/prompt/skills.ts`) is
deliberately not a full YAML parser — keep frontmatter flat and single-line:

- A `---`-delimited block at the very top of the file.
- One `key: value` pair per line.
- `name` and `description` are **required**; a skill missing either is silently skipped
  during discovery (a malformed skill directory should never take down prompt loading for
  every other skill).
- Values may optionally be wrapped in double quotes — useful when a description itself
  contains a colon or leading/trailing whitespace you want to preserve. `\"` and `\\` are
  unescaped inside quoted values.
- No nested YAML, lists, or multi-line values in frontmatter — put anything beyond
  name/description in the file's body instead.

## Writing the description

The description is the *only* text a model sees before deciding whether to invoke your
skill (via `Skill`) or search for it (via `ToolSearch`) — it is not shown the body until it
asks. Write it like a routing hint, not a title: state what situations should trigger this
skill and what it covers, the same way `src/prompt/skills/cli-tools/SKILL.md`'s own
description is written as a list of triggering scenarios rather than a name restatement.

## Where to put `skillPaths`

```json
{
  "skillPaths": ["./skills", "/opt/dh-shared-skills"]
}
```

Any number of directories; each is scanned independently, one level deep. There's no
recursive discovery — a skill directory nested two levels down under a `skillPaths` entry
won't be found.

## Testing a new skill

There's no `dh doctor`/dry-run yet (tracked separately) — the practical way to verify a new
`SKILL.md` parses correctly is to start `dh` (or `dh --web`) with `skillPaths` pointing at
it and confirm the skill appears in "Available skills" in the system prompt the agent
receives (visible in that agent's JSONL log's first `message` event, or by asking the agent
directly what skills it sees).
