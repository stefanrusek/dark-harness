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
| `--port <n>` | Listen port (`--server`) or target port (`--connect`). Default `4000`. |

Client and server talk over **HTTP + SSE on a single port** — not WebSocket — so the
connection survives ordinary HTTP proxies and reconnects cleanly via `Last-Event-ID`.

## Configuration — `dh.json`

```json
{
  "options": { "defaultModel": "sonnet" },
  "models": [
    { "name": "sonnet", "provider": "anthropic", "model": "sonnet-5" },
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
- **`systemPrompt`** — optional path to a file that fully replaces the built-in system
  prompt.
- **`options.defaultModel`** — required; the model used when a tool/agent spawn doesn't name
  one. **`options.runInBackgroundDefault`** overrides the default (`true`) for every
  async-capable tool.
- **`security`** — see below.

Full schema rationale: [`docs/adr/0007-dhjson-schema.md`](docs/adr/0007-dhjson-schema.md).

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

## Tools, skills, and sub-agents

The root agent and every sub-agent get one fixed tool set, with semantics mirroring Claude
Code's tools of the same name: `Bash`, `Read`, `Edit`, `Write`, `Agent`, `ToolSearch`,
`Skill`, `TaskOutput`, `SendMessage`, `Monitor`, `TaskStop`, `McpAuth`. Sub-agents are
purely ad-hoc — `Agent` takes a model name and a prompt, no predefined agent definitions,
arbitrary nesting depth, and (by default) run concurrently with their parent.

Every session is logged automatically: one JSONL file per agent, resumable and diffable,
with enough in each file's header line to reconstruct the full agent tree without parsing
event bodies. Agents never call a logging tool — their output *is* the log.

## Contributing / how this was built

This project was built by a small fleet of AI agents coordinating through durable documents
rather than a shared conversation — the practice is documented in
[`METHODOLOGY.md`](METHODOLOGY.md), and the project-specific rules (stack, ownership map,
invariants, quality gates) are in [`CLAUDE.md`](CLAUDE.md). Contributors extending `dh`
should read both before their first change.

## Status / deferred this round

- No logo or wordmark yet.
- This README will grow a config-reference generated/checked against
  `src/contracts/config.ts` as that stabilizes; for now the sample above is kept in sync by
  hand with ADR 0007.

## License

MIT — see [`LICENSE`](LICENSE).
