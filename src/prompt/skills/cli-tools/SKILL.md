---
name: cli-tools
description: "Reference for the domain-specific command-line tools dh agents run most often in real dark-factory sessions: git, gh, pnpm, tilt, kubectl, jq, doppler, npx/playwright, and curl. Use this whenever a task involves version control, GitHub PRs/CI, a pnpm-managed JS/TS project, a Tilt-based dev environment, a Kubernetes cluster, shaping or querying JSON, fetching secrets from Doppler, running one-off npm-published CLIs or browser automation, or scripting an HTTP request. Generic POSIX tools (grep, sed, find, ls, cat, ...) are not covered here — use your existing knowledge of those."
---

# CLI tools reference

Practical notes for the tools that show up constantly in real dh sessions. This is a
reference, not a tutorial — skim the section for the tool you need.

## git

- Prefer small, focused commits with clear messages; never `--amend` a commit another agent
  might already be building on top of, and never force-push a shared branch — see
  PLAYBOOK.md §6 on shared-tree discipline (revert, don't force-push).
- `git status` / `git diff` / `git diff --staged` before every commit — know exactly what
  you're about to commit.
- `git log --oneline -n 20` to pick up a repo's existing commit-message style before adding
  your own.
- In a shared working tree: commit before you yield a turn. In a per-agent worktree: your
  changes only reach others once pushed/merged, so don't assume a peer sees your working
  tree.
- `git worktree add/list/remove` for isolated checkouts when running in a fleet with
  per-agent worktrees.
- `git stash` only on your own uncommitted work, never on another agent's — an autostash or
  reset over someone else's dirty tree destroys work in progress.

## gh (GitHub CLI)

- `gh pr create --title ... --body ...` (use a heredoc for multi-line bodies); `gh pr view`,
  `gh pr diff`, `gh pr checks` to inspect status before merging.
- `gh issue list/view/create` for issue-tracker work; `gh api <path>` for anything the
  higher-level subcommands don't cover (e.g. `gh api repos/OWNER/REPO/pulls/N/comments`).
- `gh run list` / `gh run view <id> --log` to pull CI logs directly instead of guessing why a
  check failed.
- `gh pr merge` only when you've been asked to merge — merging is often an authority
  decision that belongs to the owner/coordinator, not a default action.

## pnpm

- `pnpm install` (respects the lockfile; use `--frozen-lockfile` in CI-like contexts to
  fail fast on drift rather than silently rewriting it).
- `pnpm -w` / `pnpm --filter <pkg>` for monorepo/workspace-scoped commands.
- `pnpm run <script>` to run a package.json script; `pnpm exec <bin>` to run a locally
  installed binary without a full `dlx` fetch.
- `pnpm dlx <pkg>` for a one-off run of a package you don't want to add as a dependency.

## tilt

- `tilt up` starts the dev environment defined by a `Tiltfile`; `tilt up --stream=true` (or
  check `tilt logs`) to follow output non-interactively — useful when you're driving it from
  a script rather than a terminal.
- `tilt ci` runs the same resources to completion and exits, which is usually what you want
  in an unattended/dark-factory context rather than the long-running `tilt up`.
- `tilt logs <resource>` and `tilt get uiresources` to check the state of individual
  services without the full UI.

## kubectl

- `kubectl get <resource> -n <namespace>` before mutating anything — confirm what actually
  exists.
- `kubectl logs <pod> -n <namespace> [-c <container>] [--previous]` for diagnosing a crashed
  or restarting pod.
- `kubectl describe <resource> <name> -n <namespace>` for events/conditions when something
  is stuck (pending, crashlooping, failing readiness).
- `kubectl apply -f <file>` for declarative changes; prefer it over imperative `create`/
  `edit` so the change is reproducible from a file you can show in your report.
- Always pass `-n <namespace>` explicitly rather than relying on whatever context default is
  set — the default can silently differ between environments.

## jq

- `jq '.'` to pretty-print and sanity-check a JSON blob before you trust its shape.
- `jq -r '.field'` for a raw (unquoted) string you're about to pipe into another command.
- `jq '.items[] | select(.status == "failed")'` — filter arrays with `select` rather than
  hand-rolling loops in shell.
- `jq -c` for compact single-line output when you need one JSON object per line (e.g.
  matching this project's own JSONL log format).

## doppler

- `doppler run -- <command>` injects secrets from the configured Doppler project as
  environment variables for the duration of `<command>` — prefer this over exporting secrets
  into the shell yourself.
- `doppler secrets` / `doppler secrets get <NAME> --plain` to inspect what's available when
  a command fails due to a missing credential.
- Never echo a secret value into a log or commit it to a file — treat anything doppler hands
  you the same way this project treats `security.token` (ADR 0004): capture it in
  environment variables, never in plaintext output.

## npx / playwright

- `npx <pkg>` runs a package without a permanent install, resolving from the local
  `node_modules` first, falling back to a fetch — same one-off use case as `pnpm dlx`.
- `npx playwright install` fetches browser binaries before the first run in a fresh
  container; `npx playwright test` runs the test suite headlessly by default.
- `npx playwright test --headed` / `--debug` only for interactive local debugging — never in
  an unattended/dark-factory run.

## curl

- `curl -sS <url>` (silent but still show errors) is the default flag pair for scripted use;
  add `-f` to make curl exit non-zero on an HTTP error status instead of printing the error
  body and succeeding.
- `curl -sS -X POST -H 'Content-Type: application/json' -d '{"key":"value"}' <url>` for a
  quick JSON POST; pipe the response into `jq` to inspect it.
- `curl -i` to see response headers when debugging redirects, auth failures, or content
  negotiation.
- When testing dh's own client↔server protocol (ADR 0002), remember the SSE stream and the
  command POSTs are separate channels — a POST response is not paired to anything on the
  event stream.
