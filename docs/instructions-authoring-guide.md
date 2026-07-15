# Writing an instructions file

`dh --instructions <file>` is the primary unattended entry point: the root agent starts on
this file's contents immediately, with no human in the loop (HANDOFF.md's founding
dark-factory scenario). There's no required format — it's read as plain text and handed to
the model as the first message — but a well-structured file dramatically improves how
reliably an unattended run finishes cleanly.

## Suggested structure

```markdown
# Goal

One or two sentences: what "done" looks like, in outcome terms, not step-by-step instructions.

# Scope

What's in bounds and what isn't. Be explicit about directories/files the agent should and
shouldn't touch — this is the single biggest lever for keeping an unattended run from
wandering into unrelated changes.

# Constraints

Anything that would otherwise require a judgment call: coding conventions to follow, tests
that must keep passing, things that must NOT change (a public API, a schema, a config
default), and how to handle ambiguity (see the harness's own "escalate, don't guess" /
unattended-escalation discipline in the system prompt).

# Success criteria

Concrete, checkable conditions — "all tests pass", "the CLI accepts flag X", "the README
documents Y" — not just a restatement of the goal. This is what the agent should verify
before ending its turn, and what you check afterward when reviewing the result.
```

## Example

```markdown
# Goal

Add a `--dry-run` flag to the CLI that prints what would happen without making changes.

# Scope

Only `src/cli.ts` and its test file. Do not touch `src/agent/` or `src/server/`.

# Constraints

- Follow the existing flag-parsing pattern already used for `--job`/`--port` in `src/cli.ts`.
- Do not change the exit-code contract (ADR 0006) — `--dry-run` still exits 0/1/2+ normally.
- If the flag's interaction with `--job` is ambiguous, state your interpretation in your
  final response rather than guessing silently (this is an unattended run — no one is
  watching to ask).

# Success criteria

- `dh --dry-run --instructions ./TASK.md` runs the root agent but the process reports the
  actions it would take rather than a tool actually mutating files/network state.
- `bun run typecheck && bun run lint && bun run test:coverage` all pass.
- A short usage note is added to `README.md`'s flags table.
```

## Why this shape

The harness's own system prompt (`src/prompt/system-prompt.ts`) already teaches the model a
generic working discipline (escalate vs. guess, commit before yielding, no silent
truncation, `TASK_FAILED` reporting). What it cannot know without you telling it is
*this run's* scope, constraints, and definition of done — an instructions file that's
missing "success criteria" in particular tends to produce runs that stop as soon as the
model believes it's "roughly done," which may not match what you actually wanted checked.

## Related

- [`README.md`](../README.md) — flags, run modes, exit codes.
- [`docs/adr/0006-exit-code-contract.md`](adr/0006-exit-code-contract.md) — how
  self-reported success/failure maps to the process exit code.
- [Troubleshooting / FAQ](troubleshooting.md) — what to do when an unattended run didn't do
  what the instructions file asked.
