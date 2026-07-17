---
name: forked-subagent
description: "Dispatch a sub-agent as a real OS subprocess (the `claude` CLI, non-interactive) with its cwd hard-scoped to a target directory — optionally a dedicated git worktree it creates for you — instead of the in-process Agent tool's shared checkout. Use this whenever a sub-agent will write files and you want filesystem-enforced isolation rather than directory-ownership convention: implementation work, anything with real file-write risk, or any task where a confused sub-agent writing outside its assigned scope would be a real problem. Not a full replacement for the in-process Agent tool — for read-only research, quick lookups, or anything that doesn't write files, Agent remains lower-overhead (no subprocess spin-up, no worktree bookkeeping)."
---

# forked-subagent

Launches Claude Code as a genuine child process (`claude -p ...`) with `cwd` set to a
directory you choose, waits for it to finish, and returns a result comparable to what the
in-process `Agent` tool gives you: a text summary plus success/exit status. Optionally
creates (or reuses) a dedicated `git worktree` first, so the sub-agent's entire filesystem
view really is confined to that worktree — not just conventionally scoped by a prompt
instruction it could ignore or misread.

Built for Dark Harness ticket `tracking/DH-0114-*.md`: this project's own coordinator was
dispatching implementers via the in-process `Agent` tool against one shared checkout, relying
on directory ownership (CLAUDE.md §3) as a convention rather than a hard boundary — a
confused sub-agent had already once written outside its assigned domain, swept another
agent's staged files into a commit, and briefly broke `main`. This skill is not Dark
Harness-specific, though — it's checked in generically so any project can reuse "launch a
real forked `claude` subprocess scoped to a directory" (per the ticket's second User Story).

All scripts are TypeScript, run directly with `bun` (no build step, no separate install) —
unlike `.claude/skills/spile-ops/` (Python-stdlib-only, explicitly outside this repo's Bun
toolchain), this skill spawns `claude` itself and reads its JSON output, so Bun is the
natural fit. Nothing here lives under `src/` or is wired into `dh`'s own build/typecheck/test
gates — it's coordinator/process tooling, not part of the `dh` product.

## When to use this vs. the in-process `Agent` tool

- **Use forked-subagent** for implementation work — anything that will create, edit, or
  delete files, or run commands with side effects — where you want the sub-agent's blast
  radius physically limited to one directory (typically a dedicated worktree), independent of
  whether its prompt correctly self-scopes.
- **Use the in-process `Agent` tool** for read-only research, code search, quick lookups,
  or analysis that produces only a text report — no file-write risk, so the overhead of
  spinning up a real subprocess (and, if using worktrees, `git worktree add`/cleanup) buys
  nothing. `Agent` is also the right choice when you want the sub-agent to see files the
  invoking session has already touched in the same shared checkout (uncommitted state a
  fresh worktree wouldn't have).
- This skill does not replace `Agent` — it's an additional, higher-isolation dispatch path
  for the subset of tasks where isolation actually matters.

## Scripts

All under `scripts/`, invoked directly with `bun`:

### `dispatch.ts` — the low-level primitive: run claude in a directory

```
bun .claude/skills/forked-subagent/scripts/dispatch.ts \
  --dir /path/to/some/directory \
  --prompt "Implement the thing described in TICKET.md. Report what you changed."
```

Flags:
- `--dir <path>` (required) — the subprocess's `cwd`. Any plain directory works; it does not
  need to be a git worktree.
- `--prompt "text"` or `--prompt-file <path>` (exactly one required).
- `--model <name>` — optional, forwarded to `claude --model`.
- `--permission-mode <mode>` — optional, forwarded to `claude --permission-mode` (e.g.
  `acceptEdits`, `bypassPermissions`) if you want the sub-agent to run without interactive
  prompts. Omit it to inherit whatever the ambient `claude` config/classifier does by default.
- `--timeout-ms <n>` — optional; kills the subprocess and returns a failure result if it
  doesn't finish in time.

Runs `claude -p <prompt> --output-format json` under the hood (verified against this
environment's real `claude --help`), parses the JSON result envelope, and prints one JSON
object to stdout:

```json
{
  "success": true,
  "exitCode": 0,
  "result": "<claude's final text output>",
  "sessionId": "...",
  "costUsd": 0.08,
  "durationMs": 2511,
  "dir": "/path/to/some/directory",
  "raw": { "...": "the full --output-format json payload" }
}
```

The process's own exit code mirrors the subprocess's exit code, so callers that only care
about pass/fail can check `$?` without parsing JSON.

### `worktree.ts` — create/reuse and clean up a git worktree

```
bun .claude/skills/forked-subagent/scripts/worktree.ts create \
  --repo /path/to/repo --branch DH-0114-thing [--base main] [--path <explicit-dir>]

bun .claude/skills/forked-subagent/scripts/worktree.ts cleanup \
  --repo /path/to/repo --path <worktree-dir> --branch DH-0114-thing [--force] [--keep-branch]
```

- `create` prints the worktree's absolute path on stdout. If a worktree already exists at the
  default (or given) path and is a registered worktree of the repo, it's reused rather than
  re-created. If the branch already exists, the worktree is attached to it instead of trying
  to `-b` a duplicate.
- Default worktree location: a sibling directory `<repo>-worktrees/<branch>` next to the repo
  (never nested inside it).
- `cleanup` follows the same discipline as the `Workflow` tool's `isolation: "worktree"`
  mode: remove the worktree (and its branch, unless `--keep-branch`) only if it has **no
  uncommitted changes** *and* its branch is **fully merged** into the base ref (`--base`,
  default `HEAD`) it was created from. Otherwise it's left in place and the reason is printed,
  so a failed or still-in-progress run can be inspected rather than silently lost. `--force`
  skips both checks and removes unconditionally (e.g. a known-bad run you don't need to
  inspect).

### `run-in-worktree.ts` — the combined flow (User Story 1, end to end)

```
bun .claude/skills/forked-subagent/scripts/run-in-worktree.ts \
  --repo /path/to/repo \
  --branch DH-0114-thing \
  --prompt "Implement the thing described in TICKET.md." \
  [--base main] [--model sonnet] [--permission-mode acceptEdits] [--keep]
```

Creates/reuses the worktree, dispatches `claude` into it, then applies the cleanup discipline
above (pass `--keep` to skip cleanup entirely and always leave the worktree, e.g. while
iterating). Prints one JSON object combining `dispatch.ts`'s result with `worktreePath`,
`branch`, and a `cleanup` field (`null` if `--keep` was passed). Exit code mirrors the
sub-agent's own exit code.

## Tests

Real integration tests — no mocking of `child_process`/`git`, since a script whose entire job
is spawning a subprocess or a git worktree can't be meaningfully unit-tested by mocking that
call (see `CLAUDE.md` §9). Run on demand (not part of `dh`'s own `bun run test:coverage`
gate):

```
bun test ./.claude/skills/forked-subagent/scripts/worktree.test.ts       # real git, no API cost
bun test ./.claude/skills/forked-subagent/scripts/dispatch.test.ts       # real claude subprocess, small API cost
bun test ./.claude/skills/forked-subagent/scripts/run-in-worktree.test.ts # both combined, small API cost
```

- `worktree.test.ts` exercises `createWorktree`/`cleanupWorktree` against real scratch git
  repos: fresh creation, reuse, dirty-worktree-left-in-place, unmerged-but-clean-left-in-place,
  merged-and-clean-removed, and `--force`.
- `dispatch.test.ts` spawns a real `claude -p` subprocess against a scratch directory and
  checks the parsed result shape and a real file-write round-trip.
- `run-in-worktree.test.ts` is the full end-to-end proof for the isolation guarantee this
  skill exists for: a real `claude` subprocess writes and commits a file inside a real,
  dedicated worktree, and the test asserts that file exists in the worktree but **not** in
  the shared repo checkout — then exercises the merge-then-cleanup path.

## Design notes

- `claude --output-format json`'s result envelope (`is_error`, `result`, `session_id`,
  `total_cost_usd`, `duration_ms`, ...) was confirmed against this environment's real
  installed `claude --help` and a live `claude -p ... --output-format json` run — not assumed
  from memory.
- `dispatch.ts` has no git awareness at all; it only knows "run claude in this directory."
  `worktree.ts` has no claude awareness; it only knows git worktree lifecycle. `run-in-worktree.ts`
  composes the two. Keeping them separate means either can be used standalone — e.g.
  `dispatch.ts` against a plain scratch directory with no git involved at all, or `worktree.ts`
  to prep a worktree for a completely different tool.
- `git branch --merged` prefixes the currently-checked-out branch with `*` and any branch
  checked out in *another* worktree with `+` — `cleanupWorktree`'s merged-branch check strips
  both prefixes before matching (an easy bug to miss; caught it via the real-git integration
  test failing on the merged-cleanup case during development, not by inspection).
