# Dark Harness

**`dh`** is a single-binary agent harness for autonomous "dark factory" software work: point
it at a repo and an instructions file, and it runs an LLM agent — with sub-agents, a real
tool set, skills, and MCP support — until the job is done. It also runs interactively, with
both a console TUI and a web UI, so you can develop and observe locally before you let it
loose unattended.

No daemons to install, no runtime to configure — `dh` is one compiled binary that is the
server, the console client, and the web client, composed by flags.

## Security posture, up front

**`dh` speaks plaintext HTTP with no authentication by default**, and its permission model
is deliberately "everything is allowed, always" — there are no approval prompts. This is a
tradeoff for the dark-factory use case: an agent that can't ask a human before every shell
command needs to actually be able to run them.

That means **the network boundary is your only real security control.** The intended
posture is air-gapping: run `dh` in a container, on a private network, behind an SSH tunnel,
or behind a reverse proxy you control — not exposed on the open internet.

For cases where air-gapping alone isn't practical, `dh` ships two independent, opt-in
protections (see [Configuration](#configuration--dhjson) below): a bearer token and TLS.
Neither turns this into a general-purpose auth system — no user accounts, no per-agent
scopes. Air-gapping remains the strongest posture even with both enabled.

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

| Invocation | Behavior |
| --- | --- |
| `dh` | Local: server + console TUI in one process. |
| `dh --web` | Local web: server + locally-served web UI; prints the URL. |
| `dh --server` | Headless server only. Default port `4000`; `--port <n>` overrides. |
| `dh --connect <host>` | Console client, connecting to a remote server. |
| `dh --connect <host> --web` | Web client, served locally, connected to a remote server. |

The web UI is **always served client-side**, never by `--server` — a headless server exposes
only the agent API/event protocol. To get web access to a remote headless server, run
`dh --connect <host> --web` on your own machine.

Other flags:

| Flag | Meaning |
| --- | --- |
| `--instructions <file>` | Path to an instructions file. The root agent starts on it immediately, autonomously. |
| `--job` | Exit when the root agent finishes; see the exit-code table above. Without it, the process stays alive for inspection. |
| `--config <path>` | Config file location. Default: `dh.json` in the working directory. |
| `--env <file>` | Load a dotenv-style file into the environment before `dh.json` is loaded/interpolated (see below). |
| `--port <n>` | Listen port (`--server`) or target port (`--connect`). Default `4000`. |

Client and server talk over **HTTP + SSE on a single port** — not WebSocket — so the
connection survives ordinary HTTP proxies and reconnects cleanly via `Last-Event-ID`.

## Configuration — `dh.json`

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
  is how the `"local"` provider above points at any Anthropic-compatible endpoint) or
  `type: "bedrock"` (AWS Bedrock via the standard AWS credential chain).
- **`$(VAR)`** in any string value resolves against the environment at load time — e.g.
  `"apiKey": "$(ANTHROPIC_API_KEY)"`.
- **`skillPaths`** — directories scanned for skill folders (each containing a `SKILL.md`,
  the same convention Claude Code uses). `dh` also always bundles a `cli-tools` skill
  covering `git`, `gh`, `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`, and
  `curl` — no config needed for that one.
- **`mcpServers`** — a Claude Code-style map of MCP server definitions (stdio and HTTP).
- **`systemPrompt`** — optional path to a file whose contents replace the built-in
  working-discipline preamble. The `TASK_FAILED`/logging contract the harness's own
  exit-code behavior depends on is always appended after it regardless — see
  [`docs/adr/0006-exit-code-contract.md`](docs/adr/0006-exit-code-contract.md).
- **`options.defaultModel`** — required; the model used when a tool/agent spawn doesn't name
  one. **`options.runInBackgroundDefault`** overrides the default (`true`) for every
  async-capable tool. **`options.maxTurns`** overrides the agent loop's default safety-valve
  turn cap (100) for every agent this runtime runs, root and sub-agents alike — the default
  exists to bound a pathological loop, not to constrain a legitimate long-running
  dark-factory task.
- **`security`** — see below.

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
canonical "clone a repo and work on it" scenario (HANDOFF.md's founding use case) is entirely
the operator's responsibility to set up before starting `dh`. The convention:

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
  (the default).

Rationale and scope: [`docs/adr/0004-security-posture.md`](docs/adr/0004-security-posture.md).

### Keeping secrets out of `dh.json`: `--env <file>`

`--env <file>` loads a dotenv-style file (`KEY=VALUE` per line, `#` comments, blank lines
skipped, optional surrounding double-quotes on the value) into the process environment
*before* `dh.json` is loaded — so its `$(VAR)` interpolation can resolve against it.

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

## Tools, skills, and sub-agents

The root agent and every sub-agent get one fixed tool set, with semantics mirroring Claude
Code's tools of the same name: `Bash`, `Read`, `Edit`, `Write`, `Agent`, `ToolSearch`,
`Skill`, `TaskOutput`, `SendMessage`, `Monitor`, `TaskStop`, `McpAuth`. Sub-agents are
purely ad-hoc — `Agent` takes a model name and a prompt, no predefined agent definitions,
arbitrary nesting depth, and (by default) run concurrently with their parent.

Every session is logged automatically: one JSONL file per agent, resumable and diffable,
with enough in each file's header line to reconstruct the full agent tree without parsing
event bodies. Agents never call a logging tool — their output *is* the log.

## Further documentation

- [TUI keybindings reference](docs/tui-keybindings.md)
- [Web UI guide](docs/web-ui-guide.md)
- [Writing an instructions file](docs/instructions-authoring-guide.md)
- [JSONL log format reference](docs/jsonl-log-format.md) (user-facing; ADR 0005 is the
  authoritative schema source)
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
  of relying on manual diligence (DH-0042).

## License

MIT — see [`LICENSE`](LICENSE).
