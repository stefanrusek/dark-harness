# Dark Harness

**`dh`** is a single-binary agent harness for autonomous "dark factory" software work: point
it at a repo and an instructions file, and it runs an LLM agent — with sub-agents, a real
tool set, skills, and MCP support — until the job is done. It also runs interactively, with
both a console TUI and a web UI, so you can develop and observe locally before you let it
loose unattended.

No daemons to install, no runtime to configure — `dh` is one compiled binary that is the
server, the console client, and the web client, composed by flags.

<!-- Promo screenshot goes here (see design-review ticket). -->

## Security posture, up front

**`dh` speaks plaintext HTTP with no authentication by default**, and its permission model
is deliberately "everything is allowed, always" — there are no approval prompts. This is a
tradeoff for the dark-factory use case: an agent that can't ask a human before every shell
command needs to actually be able to run them.

That means **the network boundary is your only real security control.** The intended
posture is air-gapping: run `dh` in a container, on a private network, behind an SSH tunnel,
or behind a reverse proxy you control — not exposed on the open internet. Air-gapped here
means `dh` itself makes no outbound network calls except to whichever LLM provider you
configure (and whatever `git`/network access your own instructions or Bash-tool commands
make) — if you point it at a fully local provider (e.g. LM Studio or another
Anthropic-compatible local endpoint via `baseURL`), it needs no external network access at
all to run.

For cases where air-gapping alone isn't practical, `dh` ships two independent, opt-in
protections (see [Configuration](#configuration--dhjson) below): a bearer token and TLS.
Neither turns this into a general-purpose auth system — no user accounts, no per-agent
scopes. Air-gapping remains the strongest posture even with both enabled. Full rationale:
[`docs/adr/0004-security-posture.md`](docs/adr/0004-security-posture.md).

## Quick start

```bash
# Run it directly, no install
bunx dark-harness

# ...or build from source
git clone https://github.com/<org>/dark-harness.git
cd dark-harness
bun install
bun run build        # produces ./dist/dh
./dist/dh
```

Requires Bun >= 1.3. There's nothing else to install — `dh` compiles to a single binary
(`bun build --compile`) for linux/macos (x64+arm64) and windows-x64.

Scaffold a starter config and sanity-check it before your first real run:

```bash
dh init            # writes a starter dh.json in the working directory
# edit dh.json to set your API key / model
dh doctor          # makes one cheap no-op call per configured model and reports pass/fail
dh                 # local server + console TUI, using dh.json
```

With no flags, `dh` starts a server and a console TUI in one process, using `dh.json` in the
current directory (see below). Point it at a task and let it run unattended:

```bash
dh --instructions ./TASK.md --job
```

`--job` makes the process exit when the root agent finishes: `0` on self-reported success,
`1` on self-reported task failure, `2+` on a harness-level error (bad config, provider
failure, crash) — safe to branch on from CI or a scheduler without parsing logs.

## Run modes

One binary, two logical processes — **server** (runs the agents, owns state and logs) and
**client** (console TUI or web UI) — composed by flags:

| Invocation | Behavior | When to use it |
| --- | --- | --- |
| `dh` | Local: server + console TUI in one process. | Everyday interactive use on your own machine. |
| `dh --web` | Local web: server + locally-served web UI; prints the URL. | Same as above, browser UI instead of a terminal. |
| `dh --server` | Headless server only. Default port `4000`; `--port <n>` overrides. | Long-running/unattended box you'll connect to remotely, or a container for a dark-factory job. |
| `dh --connect <host>` | Console client, connecting to a remote server. | Watching/steering a session already running elsewhere. |
| `dh --connect <host> --web` | Web client, served locally, connected to a remote server. | Browser access to a remote headless server. |

The web UI is **always served client-side**, never by `--server` — a headless server exposes
only the agent API/event protocol. To get web access to a remote headless server, run
`dh --connect <host> --web` on your own machine.

Client and server talk over **HTTP + SSE on a single port** — not WebSocket — so the
connection survives ordinary HTTP proxies and reconnects cleanly via `Last-Event-ID`.

## Command-line reference

Subcommands:

| Command | Behavior |
| --- | --- |
| `dh init` | Scaffold a starter `dh.json` in the working directory (or `--config <path>`). Refuses to overwrite an existing file. |
| `dh doctor` | Alias for `--check` (below). |
| `dh logs <sessionDir>` | Print the agent tree (status/cost/duration) for a `.dh-logs/<sessionId>` directory, e.g. `dh logs .dh-logs/3f2c...`. |

Flags:

| Flag | Meaning |
| --- | --- |
| `--web` | Serve the web UI instead of (or alongside `--connect`) the console TUI. |
| `--server` | Run headless (no client attached). |
| `--connect <host>` | Connect to a remote `dh --server` instead of starting a local one. |
| `--port <n>` | Listen port for `--server`, or target port for `--connect`. Default `4000`. |
| `--instructions <file>` | Path to an instructions file. The root agent starts on it immediately, autonomously. |
| `--job` | Exit when the root agent finishes; see the exit-code table above. Without it, the process stays alive for inspection. |
| `--config <path>` | Path to `dh.json`. Default: `dh.json` in the working directory. |
| `--env <file>` | Load a dotenv-style file into the environment before `dh.json` is loaded/interpolated (see below). |
| `--check` | For each configured model, make one cheap no-op provider call and report pass/fail, then exit. Never enters the agent loop. Same as `dh doctor`. |
| `--dry-run` | Validate config parsing, instructions-file readability, and provider client construction, then exit `0`. Never calls a model. |
| `--resume <sessionId>` | Reconstruct the root agent's conversation from a prior `.dh-logs/<sessionId>` directory and continue it as a new session. Not supported together with `--connect`. |
| `--help`, `-h` | Show usage and exit. |
| `--version` | Show build identity (version, git sha, dirty flag) and exit. |

A few examples:

```bash
dh --config ./configs/prod.dh.json --check     # verify a specific config's providers
dh --env secrets.env                            # load API keys from a gitignored env file
dh --instructions ./TASK.md --dry-run           # sanity-check before spending any tokens
dh --resume 3f2c9e21-...                        # pick a crashed/interrupted session back up
dh logs .dh-logs/3f2c9e21-...                   # inspect a session's agent tree after the fact
```

`--resume` walks any `resumedFrom` chain in the target session's logs, reconstructs the root
agent's history, and appends a notice to the resumed conversation naming any sub-agent that
didn't survive the restart. It's not supported with `--connect` (the logs it reconstructs
from live on the *server's* filesystem, not the connecting client's), and it isn't yet
supported together with `--instructions` delivered to a remote server.

## Configuration — `dh.json`

This is exactly what `dh init` scaffolds:

```json
{
  "options": { "defaultModel": "sonnet", "runInBackgroundDefault": true, "maxTurns": 100 },
  "models": [
    {
      "name": "sonnet",
      "provider": "anthropic",
      "model": "sonnet-5",
      "inputPricePerMToken": 3,
      "outputPricePerMToken": 15
    },
    { "name": "gemma4", "provider": "bedrock", "model": "gemma4" }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic" },
    { "name": "bedrock", "type": "bedrock" },
    { "name": "local", "type": "anthropic", "baseURL": "http://localhost:8080" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
```

- **`models`** — named entries mapping to a named `provider` plus a provider-side model id.
  Tools and options refer to models by `name`, never by the provider-side id directly.
  Optional **`inputPricePerMToken`**/**`outputPricePerMToken`** (USD per million tokens) drive
  the token/cost display in the TUI and web UI — there's no built-in pricing table (no public
  fixed price exists for local/Bedrock models), so cost tracking for a model is opt-in via
  these fields. If only one of the pair is set, the other side of that model's cost is
  treated as `$0`; if neither is set, cost stays unreported (`undefined`) for that model
  rather than showing a misleading `$0.00`.
- **`provider`** — `type: "anthropic"` (the Anthropic SDK; supports a custom `baseURL`, which
  is how the `"local"` provider above points at any Anthropic-compatible endpoint, e.g.
  LM Studio) or `type: "bedrock"` (AWS Bedrock via the standard AWS credential chain — see
  below). Each provider also accepts an optional `retry` block (`maxAttempts`,
  `baseDelayMs`, `maxDelayMs`) tuning transient-failure retry/backoff; all have built-in
  defaults.
- **`$(VAR)`** in any string value resolves against the environment at load time — e.g.
  `"apiKey": "$(ANTHROPIC_API_KEY)"`. To use a literal `$(...)`-shaped string (meant for
  something other than `dh`'s own interpolation — e.g. a value a Bash tool call's subprocess
  should see verbatim), escape it as `$$(...)`: `$$(FOO)` resolves to the literal text
  `$(FOO)`, with no environment lookup attempted.
- **`skillPaths`** — directories scanned for skill folders (each containing a `SKILL.md`,
  the same convention Claude Code uses). `dh` also always bundles a `cli-tools` skill
  covering `git`, `gh`, `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`, and
  `curl` — no config needed for that one.
- **`mcpServers`** — a Claude Code-style map of MCP server definitions (stdio and HTTP), each
  with an optional `timeoutMs` overriding the connect/call timeout defaults. See
  [MCP server configuration examples](docs/mcp-servers.md). Tool discovery against
  configured servers is still a work in progress today — see
  [Known gaps](#known-gaps) below.
- **`systemPrompt`** — optional path to a file whose contents replace the built-in
  working-discipline preamble. The `TASK_FAILED`/logging contract the harness's own
  exit-code behavior depends on is always appended after it regardless.
- **`options.defaultModel`** — required; the model used when a tool/agent spawn doesn't name
  one. **`options.runInBackgroundDefault`** overrides the default (`true`) for every
  async-capable tool. **`options.maxTurns`** overrides the agent loop's default safety-valve
  turn cap (100) for every agent this runtime runs, root and sub-agents alike — the default
  exists to bound a pathological loop, not to constrain a legitimate long-running
  dark-factory task.
- **Session-wide budgets** (all optional; omitted means no cap of that kind) —
  `options.maxCostUsd` and `options.maxTotalTokens` cap cumulative spend/tokens across the
  whole session (root plus every sub-agent); `options.maxWallClockMs` caps total duration
  independent of turn count; `options.maxConcurrentAgents` caps how many agents can be live
  at once; `options.maxAgentDepth` caps sub-agent nesting depth (the root is depth 0). A
  cost/token/wall-clock cap stops the whole session (every live agent), logging why to each
  agent's own JSONL stream; a fan-out cap refuses the specific `Agent` spawn that would
  exceed it, surfaced back to the spawning agent as a normal tool error.
- **`security`** — see below.
- **`limits.completedRetention`** — caps how many terminal/completed entries the harness's
  in-memory structures (e.g. the task registry) retain before evicting the oldest, so a
  long/wide-fanout session's memory footprint reflects currently-relevant agents rather than
  every agent ever spawned. Optional; defaults to 50. Active (running/waiting) entries are
  never evicted regardless of count.
- **`logRetention`** — optional `.dh-logs/` rotation policy: `maxAgeMs` deletes a session
  directory once its most recently written file is older than that; `maxTotalBytes` then
  deletes the oldest remaining session directories (by last write) until total size is back
  under the cap. Both independent and optional; omitted means no pruning (the default).

Full schema rationale: [`docs/adr/0007-dhjson-schema.md`](docs/adr/0007-dhjson-schema.md).

### AWS Bedrock setup

```json
{
  "provider": [
    { "name": "bedrock", "type": "bedrock", "region": "us-west-2" }
  ],
  "models": [
    { "name": "sonnet", "provider": "bedrock", "model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" }
  ]
}
```

- **`provider.region`** — the AWS region the Bedrock endpoint is called in (e.g.
  `us-west-2`). If omitted, the AWS SDK falls back to its own region resolution (an
  `AWS_REGION`/`AWS_DEFAULT_REGION` env var, or a configured region in `~/.aws/config`).
- **Credentials** — `dh` does no custom credential handling for Bedrock; it relies entirely
  on the AWS SDK's standard credential chain, the same one any AWS CLI tool uses. In order:
  environment variables (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_SESSION_TOKEN`), the shared credentials/config files (`~/.aws/credentials`,
  `~/.aws/config`, respecting `AWS_PROFILE`), and finally an instance/container/task role
  when running on EC2, ECS, or Lambda. There is no `dh.json` field for an access key —
  configure credentials the normal AWS way, outside the config file.
- **Errors** surface through the same `ProviderError` wrapping as the Anthropic provider —
  nothing Bedrock-specific about the error shape. In practice, most Bedrock failures are
  account/model availability issues rather than `dh` misconfiguration: Bedrock model ids are
  region- and account-specific (a model enabled in one region/account may not be in
  another), and some ids that are syntactically valid are legacy or deprecated. An
  "invalid model" or "access denied" error is usually a sign to check model access in the
  AWS Bedrock console for that region/account, not a `dh.json` problem.

### Git credentials and workspace convention

`dh` has no `workspaceDir`-style config field and does no repo checkout of its own — the
canonical "clone a repo and work on it" scenario is entirely the operator's responsibility
to set up before starting `dh`. The convention:

- **Working directory is the workspace.** The `Bash` tool runs every command at the
  process's own current working directory (`process.cwd()` at `dh` startup) — there is no
  separate configured workspace path. Start `dh` with its working directory already set to
  the checked-out repo (e.g. a container's `WORKDIR`, or `cd`'d into the repo before
  invoking `dh` on the host). `dh.json` itself is looked up relative to that same directory
  by default (`--config` to override).
- **Git credentials are the container's/host's responsibility, not `dh.json`'s.** There is
  no credential field in the config schema — `git` inside a `Bash` call authenticates
  exactly as it would for a human at that same shell prompt. Recommended patterns, in order
  of how most dark-factory deployments set this up:
  - **Mounted SSH key** — mount a deploy key at `~/.ssh/id_ed25519` (read-only, correct
    permissions) with `known_hosts` pre-populated or `StrictHostKeyChecking=no` in
    `~/.ssh/config` for known-good hosts (e.g. `github.com`). Works with `git@host:org/repo`
    remotes with no further config.
  - **`GIT_ASKPASS`** — set `GIT_ASKPASS` to a small script that echoes a token from the
    environment, and use HTTPS remotes. Useful when a platform makes injecting an SSH key
    awkward but env vars easy (most container schedulers).
  - **`.netrc`** — a mounted or generated `~/.netrc` with `machine <host>` / `login` /
    `password <token>` entries; `git` over HTTPS reads this automatically with no
    per-invocation flag.
  - **PAT via env + credential helper** — set a personal-access-token env var and configure
    `git config --global credential.helper` to a one-liner that prints it; combine with
    `--env secrets.env` (below) to keep the token out of `dh.json`.

  None of these are `dh`-specific — they're the same options as any other headless git
  automation. `dh` does not special-case any of them; whichever one is already set up in the
  environment `dh` starts in is what its agents inherit.

### Optional: bearer token + TLS

```json
{
  "security": {
    "token": "$(DH_TOKEN)",
    "tls": { "cert": "/path/to/cert.pem", "key": "/path/to/key.pem" }
  }
}
```

- **`security.token`** — when set, every request (POSTs and SSE connections alike) must
  carry `Authorization: Bearer <token>` or gets a bare `401`. Constant-time compared, never
  logged. A connecting client supplies its own token via its own `dh.json`.
- **`security.tls`** — cert/key paths serve HTTPS directly on the same port. Both are
  independent and optional — token without TLS, TLS without token, both, or neither
  (the default). `--connect` dials `https://` automatically when the *connecting* side's own
  `dh.json` sets `security.tls`.

Rationale and scope: [`docs/adr/0004-security-posture.md`](docs/adr/0004-security-posture.md).

### Keeping secrets out of `dh.json`: `--env <file>`

`--env <file>` loads a dotenv-style file into the process environment *before* `dh.json` is
loaded — so its `$(VAR)` interpolation can resolve against it. The supported subset is
deliberately minimal, not a full reimplementation of any particular dotenv tool's dialect:

- `KEY=VALUE` per line; blank lines and lines starting with `#` (after trimming leading
  whitespace) are skipped as comments — `#` is *not* treated as an inline/trailing comment
  marker within a value (a value containing `#` is taken literally, in full).
- A value may be wrapped in double quotes (`"..."`), which are stripped, with `"`, `\`,
  `\n`, and `\t` escape sequences resolved inside them.
- A value may instead be wrapped in single quotes (`'...'`), which are stripped with **no**
  escape processing at all — the content between the quotes is used completely literally
  (the one way to include a literal `#`, backslash, or double-quote without any escaping).
- An unquoted value is used as-is (after trimming surrounding whitespace), with no escape
  processing.

The intended workflow: keep a gitignored `secrets.env` (populated however you like — by hand,
or via tooling like Doppler) holding real API keys, and commit a fully-functional `dh.json`
that references them only as `$(ANTHROPIC_API_KEY)` etc. No secrets ever land in the repo,
but the committed config is a real, runnable example:

```
# secrets.env (gitignored — see .gitignore)
ANTHROPIC_API_KEY=sk-ant-...
```

```json
{ "provider": [{ "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" }] }
```

```
dh --env secrets.env
```

`.gitignore` excludes `secrets.env` specifically, plus `*.env` generally.

## Running air-gapped

`dh`'s default posture — plaintext HTTP, no auth, no approval prompts — is built around
running on a network you already trust, per
[`docs/adr/0004-security-posture.md`](docs/adr/0004-security-posture.md). Practically, that
means:

- **`dh` makes no outbound calls of its own** other than to whichever model provider(s) your
  `dh.json` configures, plus whatever a running agent's own `Bash`/`git`/tool calls choose to
  reach (your instructions file controls that, not the harness). There's no telemetry,
  update-checker, or other phone-home behavior.
- **Fully offline is possible** if you point `provider` at a local, Anthropic-compatible
  endpoint (`type: "anthropic"` with a `baseURL` like `http://localhost:8080`, as the sample
  config's `"local"` provider does) — e.g. LM Studio or any other local inference server
  speaking that API shape. With a local provider and no other outbound tool calls, a
  container running `dh` needs no network egress at all.
- **The recommended deployment boundary is a container**, on a private network, behind an
  SSH tunnel, or behind a reverse proxy you control — never with a headless `--server`'s port
  exposed directly to the open internet. See [Container deployment](docs/deployment.md) for
  a reference `Dockerfile` and run patterns (unattended job, headless server + remote
  client, secret injection, log persistence).
- **If you can't fully air-gap**, layer on `security.token` (bearer auth on every request)
  and/or `security.tls` (HTTPS on the same port) — both opt-in, both described above. Neither
  adds user accounts or per-agent scopes; air-gapping is still the stronger control even with
  both enabled.

## Tools, skills, and sub-agents

The root agent and every sub-agent get one fixed tool set, with semantics mirroring Claude
Code's tools of the same name: `Bash`, `Read`, `Edit`, `Write`, `Agent`, `ToolSearch`,
`Skill`, `TaskOutput`, `SendMessage`, `Monitor`, `TaskStop`, `McpAuth`, `Grep`, `Glob`.
Sub-agents are purely ad-hoc — `Agent` takes a model name and a prompt, no predefined agent
definitions, arbitrary nesting depth, and (by default) run concurrently with their parent.

`Grep`/`Glob` are structured, cross-platform alternatives to shelling out to `grep`/`find`
via `Bash` — no shell-quoting footguns, consistent behavior across OS. `Bash`'s own
`grep`/`find` (the cli-tools skill's "generic POSIX tools") remain available too; these
aren't a replacement, just a purpose-built option for the common case.

Every session is logged automatically: one JSONL file per agent, resumable and diffable,
with enough in each file's header line to reconstruct the full agent tree without parsing
event bodies. Agents never call a logging tool — their output *is* the log. See
[JSONL log format reference](docs/jsonl-log-format.md) and `dh logs <sessionDir>` above.

Agent output is always Markdown: the built-in system prompt instructs every model to write
plain-text output as Markdown, and both the console TUI and the web UI render it as such
(headings, bold/italic, inline code, fenced code blocks, lists, blockquotes, links) rather
than showing raw Markdown syntax or passing through raw escape sequences.

## Known gaps

`dh` is under active development; a couple of things worth knowing about before you rely on
them:

- **MCP tool discovery is a stub today.** `mcpServers` config is accepted and `ToolSearch`
  runs, but it doesn't yet discover and expose real, callable tools from a configured server
  — see `tracking/DH-0002-full-mcp-client-support.md`.
- **Model output is not streamed token-by-token.** A long assistant turn appears all at once
  in the TUI/web UI when the turn completes, rather than incrementally — see
  `tracking/DH-0044-no-streaming-partial-output.md`.

Neither affects correctness of a run — both are UX/latency gaps, not missing functionality
in the sense of "the tool call doesn't happen."

## Further documentation

- [TUI keybindings reference](docs/tui-keybindings.md)
- [Web UI guide](docs/web-ui-guide.md)
- [Writing an instructions file](docs/instructions-authoring-guide.md)
- [JSONL log format reference](docs/jsonl-log-format.md)
- [Container deployment](docs/deployment.md)
- [MCP server configuration examples](docs/mcp-servers.md)
- [Writing a skill](docs/skills-authoring-guide.md)
- [Troubleshooting / FAQ](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## Contributing / how this was built

This project was built by a small fleet of AI agents coordinating through durable documents
rather than a shared conversation — the practice is documented in
[`PLAYBOOK.md`](PLAYBOOK.md), and the project-specific rules (stack, ownership map,
invariants, quality gates) are in [`CLAUDE.md`](CLAUDE.md). Contributors extending `dh`
should read both before their first change.

## Status / deferred this round

- No logo or wordmark yet.
- The config reference above is still hand-maintained prose, not generated from
  `src/contracts/config.ts` — but `src/prompt/readme-config-sync.test.ts` runs in the normal
  `bun test src` gate and fails the build if a field is added to `DhOptions` or `ModelConfig`
  without a corresponding mention landing here, so drift is now caught automatically instead
  of relying on manual diligence.

## License

MIT — see [`LICENSE`](LICENSE).
