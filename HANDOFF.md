# Founding Handoff: Dark Harness (DH)

**Addressed to:** the coordinator of the implementation fleet for this repository.
**Authored by:** the owner, via a frontier-chat bootstrap session (per METHODOLOGY.md §8).
**Companion document:** `METHODOLOGY.md` in this repo is the operating law for how the fleet works. This handoff defines *what* to build; the methodology defines *how* to organize building it.

This document is self-contained. Assume no other context exists.

---

## 1. What Dark Harness is

Dark Harness (`dh`) is an agent harness: a single Bun application, compiled to a single binary, that runs an LLM agent (and any number of sub-agents) with a minimal tool set, its own system prompt, and skill/MCP support. Its purpose is to power "dark factory" autonomous software work — the canonical deployment is a container that starts `dh` with an instructions file telling it to check out a repo and branch and work unattended until done.

It also runs interactively, with both a console TUI and a web UI, so operators can develop, test, and observe locally.

**Primary first use case (context, not scope):** the agent takes a spec and a plan and implements them. Later versions will pull specs from a ticketing system. Do not build ticketing integration now; do not preclude it.

---

## 2. Run modes and CLI

One binary, `dh`, bundling everything. Two logical processes exist — a **server** (runs the agents, owns state and logs) and a **client** (console TUI or web UI) — composed by flags:

| Invocation | Behavior |
|---|---|
| `dh` | **Local:** server + console TUI in one process. |
| `dh --web` | **Local web:** server + locally-served web UI; open/print the URL. |
| `dh --server` | **Headless server** only. Default port 4000; `--port <n>` overrides. |
| `dh --connect <host>` | **Console client** to a remote server (same port default/override). |
| `dh --connect <host> --web` | **Web client:** serves the web UI locally, connected to the remote headless server. |

Rules:

- The web UI is **always served by the client side, never by the headless server.** `--server` exposes only the agent API/event protocol. Anyone wanting web access to a headless server runs `dh --connect <host> --web` on their own machine.
- `--port` applies to whichever end the flag's process runs (server listen port, or client target port).

Additional flags:

- `--instructions <file>` — path to an instructions file (file path only, no inline text). The root agent begins executing it immediately and autonomously.
- `--job` — the process exits when the root agent finishes its instructions. Exit codes: **0** = root agent completed and self-reported success; **1** = root agent self-reported task failure; **2+** = harness error (crash, provider/auth failure, bad config, etc.). Without `--job`, the process stays alive after completion for inspection.
- `--config <path>` — config file location; default is `dh.json` in the working directory.

---

## 3. Client↔server protocol

**HTTP + SSE on a single port.** This is a locked decision (record it as an ADR): SSE was chosen over WebSocket because it is plain HTTP (survives proxies and middleboxes), has built-in reconnection with `Last-Event-ID`, and the traffic is asymmetric — heavy streaming down, small commands up.

- Server → client: SSE streams carrying **versioned JSON events** (schema carries an explicit version field). Must support resume via `Last-Event-ID`.
- Client → server: plain HTTP POST for commands (send message to root agent, request agent tree, download logs, etc.).
- The console client parses SSE itself (it is not a browser); this is trivial in Bun.
- Everything is **plaintext HTTP.** There is no auth or TLS layer in this version. Documentation (README and instructions-file guides) must state plainly that securing DH is the operator's job and steer operators toward air-gapped deployment: containers, private networks, SSH tunnels. This aligns with the permission model in §6.

---

## 4. Tools

The root agent and all sub-agents get exactly this tool set. **Semantics mirror Claude Code's tools of the same name.** Every tool that can run asynchronously accepts a `run_in_background` boolean, **default `true`**, with the default overridable in config.

Observed usage frequency from real dark-factory runs (design/optimize accordingly — Bash dominates):

| Tool | Observed count | Purpose (Claude Code semantics) |
|---|---|---|
| Bash | 1309 | Run shell commands |
| Read | 406 | Read files |
| Edit | 125 | Targeted string-replacement edits |
| Write | 75 | Create/overwrite files |
| Agent | 53 | Spawn a sub-agent |
| ToolSearch | 32 | Discover/load deferred (MCP) tools |
| Skill | 19 | Load a skill by name |
| TaskOutput | 19 | Retrieve a background task's / sub-agent's output |
| SendMessage | 12 | Send a message into a running agent's conversation |
| Monitor | 5 | Check status of running tasks/agents |
| TaskStop | 2 | Stop a task/agent |
| McpAuth | 2 | Handle MCP OAuth flows |

**Sub-agents are purely ad-hoc.** `Agent` takes a model name (from config; falls back to `options.defaultModel`), a prompt, and standard params. There are no named/predefined agent definition files. Sub-agents run concurrently with their parent by default (`run_in_background: true`); the parent coordinates via Monitor / TaskOutput / SendMessage / TaskStop. Arbitrary nesting depth.

---

## 5. Configuration — `dh.json`

Owner-provided shape (extend minimally as needed; keep this structure):

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
    { "name": "local", "type": "anthropic" }
  ]
}
```

- **Models** are named entries mapping to a named provider and a provider-side model id. Tools and options refer to models by `name`.
- **Providers** have a `type` of `"anthropic"` (Anthropic SDK; supports custom `baseURL` so a "local" provider can point at any Anthropic-compatible endpoint) or `"bedrock"` (AWS Bedrock, standard AWS credential chain). Provider entries carry whatever fields their type needs (API key, region, baseURL, …).
- **`$(VAR)` in any string value resolves to the environment variable** at load time.
- **`skillPaths`**: array of directories scanned for skill folders (each containing a `SKILL.md`, Claude Code convention). The `Skill` tool loads by name.
- **`mcpServers`**: Claude Code-style map of MCP server definitions (stdio and HTTP). `ToolSearch` defers MCP tool loading; `McpAuth` handles OAuth.
- **`systemPrompt`**: optional path overriding the built-in system prompt.
- Config-level override for the `run_in_background` default (§4).

---

## 6. System prompt and permissions

- DH ships a **built-in system prompt baked into the binary**, overridable via the `systemPrompt` config path.
- The prompt **enumerates the available skills** (name + description), Claude Code-style. Tools go to the model through the API tools parameter as usual — do not prose-list tools in the prompt.
- **Sub-agents receive the same base system prompt plus their spawn prompt.**
- **The implementation fleet authors the system prompt.** It should encode the working discipline of METHODOLOGY.md — escalate-don't-guess, commit-before-yield, status-supersedes, self-contained handoffs — since DH exists to run that methodology. It should state that all output is automatically logged (§7), so simply writing text is how an agent records its reasoning and status.
- Bundle a **CLI-tools skill** into the system prompt covering the domain-specific CLIs observed in real runs: `git` (central), `gh` (PR/CI operations), `pnpm`, `tilt`, `kubectl`, `jq`, `doppler`, `npx`/`playwright`, `curl`. Generic POSIX tools (`echo`, `grep`, `sed`, `find`, `cat`, `head`, `tail`, `ls`, `sort`, `wc`, …) need no coverage — models already have that literacy. Appendix A has the full observed-frequency list for reference.
- **Permissions: everything is allowed, always.** No approval prompts, no permission modes. The operator air-gaps the agent as appropriate; all docs and guides push toward containerized/air-gapped scenarios.

---

## 7. Session logging — first-class requirement

This is critical for diagnostics and dark-factory optimization. Treat it with the same weight as the agent loop itself.

- Every session (any mode) creates a **log directory**.
- **One JSONL file per agent.**
- The **first line of each file is a metadata header** containing at minimum: session id, agent id, parent agent id (null for root), spawn timestamp, model name, and an instructions/prompt summary or hash — enough that a tool reading only first lines across all files can reconstruct the complete **timeline and agent tree**.
- Subsequent lines: timestamped events — messages, tool calls and results, token usage, status changes, completion/failure — such that an agent's full activity is replayable from its file.
- All agent actions and output flow to these logs automatically; agents do not call a logging tool.

---

## 8. Console TUI

- **Claude Code-style full-screen TUI** using the alternate screen buffer.
- Default view: the **root agent** — streaming output plus a text input for sending it messages.
- **Left-arrow in an empty input** opens the **agent tree list**; selecting an agent shows its full output.
- **Non-root agent views are read-only** (no input box) with a key to jump back to the root view.

## 9. Web UI

Layout: **tree list of running agents on the left; clicking an agent shows its whole output on the right.** The root agent view additionally supports sending it commands. Live updates via the SSE stream.

Required for v1:

- **Status colors** per agent (running / waiting / done / failed).
- **Token and cost display** — per agent and session total.
- **Log download** — a single agent's JSONL, or the full session bundle.
- **Make it a joy to use.** This is an explicit owner requirement, not decoration: polish interaction, motion, and visual design to a standard you'd be proud to demo. Read and apply the frontend-design guidance your own harness provides if available.

---

## 10. Quality gates — hard rules

- **100% code coverage.** Not a target — a gate. CI fails below it.
- **Full end-to-end tests**: spawn the **real compiled binary** in each run mode and drive it — a PTY harness for the TUI, a headless browser for the web UI, real client↔server over HTTP/SSE across processes. The model sits behind a **mock provider endpoint** (an Anthropic-compatible local server) so e2e is deterministic and free. Real-API smoke tests are optional and manual, never in the gate.
- Standard hygiene gates besides: typecheck, lint/format. Record the exact commands in the constitution (`CLAUDE.md`).

Per METHODOLOGY.md, these objective gates are what let cheap-tier implementer output be trusted without re-reading.

---

## 11. Repository, release, and launch scope

- Repo: **`dark-harness`**; binary/command: **`dh`**; license: **MIT**.
- **README as an attractive GitHub landing page** — logo/wordmark welcome, clear pitch, quick start, mode matrix, config reference, the air-gap security stance stated up front.
- **GitHub Actions:**
  - CI on PRs and main: typecheck, lint, tests, coverage gate, e2e.
  - **Tag-driven releases:** pushing a `v*` tag runs the full gate, cross-compiles Bun binaries for linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64, attaches them to a GitHub Release with a generated changelog (conventional commits), and **publishes to npm** so `bunx dark-harness` works.
- **Ship v0.1.0** as the first GitHub release when the gates pass.

---

## 12. How to run this build (coordinator instructions)

Follow METHODOLOGY.md. Concretely:

1. **Seed the constitution.** Write `CLAUDE.md`: stack (Bun, TypeScript), ownership map, invariants distilled from this handoff, the exact gate commands, escalation triggers. Point it at METHODOLOGY.md.
2. **Record founding ADRs** from this handoff's locked decisions: single-binary multi-mode design; SSE-over-WebSocket; client-side-only web UI; plaintext/air-gap security stance; JSONL-per-agent logging schema; exit-code contract; `dh.json` schema; 100%-coverage + e2e gates.
3. **Decompose into domain handoffs.** A natural slicing: core agent loop + tools + providers; server + protocol + logging; console TUI; web UI; system prompt + skills + docs; CI/release. Adjust as you see fit — decomposition is your call, escalating per the triggers.
4. **Define the wire truth first.** The SSE event schema, POST command schema, and log-line schemas live in one shared contracts module that every domain imports. Never redeclared locally.
5. Work in **spec-driven style**: each domain handoff is a refined spec — independently testable, with its gates — before implementation starts.
6. Escalate genuine judgment calls to the architect-on-call; route authority/taste/credentials questions (npm publishing rights, repo settings, the v0.1.0 "ship it") to the owner.

Open items intentionally left to the fleet: exact SSE event/command schema, log event vocabulary beyond the required header, TUI keybinding details beyond those specified, web UI visual design, system prompt text. Decide, record, proceed.

---

## Appendix A — observed CLI usage (from real dark-factory runs)

Counts are approximate (hand-cleaned parse) but tool identities are verified. For the CLI-tools skill, cover the domain-specific entries (bold); the rest is generic shell literacy.

| Command | Count | | Command | Count |
|---|---|---|---|---|
| echo | 780 | | rm | 37 |
| **git** | 617 | | sort | 35 |
| grep | 514 | | **gh** | 20 |
| cd | 350 | | **kubectl** | 18 |
| tail | 274 | | node | 13 |
| **pnpm** | 264 | | cut | 12 |
| head | 235 | | printf | 12 |
| sed | 203 | | sleep | 9 |
| ls | 147 | | mkdir | 8 |
| cat | 138 | | **npx** | 8 |
| **tilt** | 122 | | xargs | 7 |
| find | 107 | | **curl** | 6 |
| python3 | 79 | | ps / tee | 6 each |
| date | 61 | | split | 4 |
| wc | 56 | | **playwright** | 3 |
| cp | 54 | | du / realpath | 2 each |
| **jq** | 45 | | **doppler**, zip, tr, stat, shasum, mv, comm, claude, awk, uniq, pwd | 1 each |

---

## Addendum B — Basic security features (2026-07-14)

This section supersedes the "no auth or TLS layer" statement in §3. The **default remains plaintext HTTP with no auth** — securing DH is still primarily the operator's job, and docs still steer toward air-gapped deployment. But the binary now ships two optional, config-enabled protections via a `security` block in `dh.json`:

```json
{
  "security": {
    "token": "$(DH_TOKEN)",
    "tls": {
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem"
    }
  }
}
```

**Bearer token auth** (`security.token`):

- When set on the server, **every** request — POSTs and SSE stream connections alike — must carry `Authorization: Bearer <token>`; anything else gets `401` and no information beyond that.
- Clients supply the token via their own `dh.json` (`security.token` on the connecting side) — `$(DH_TOKEN)` env interpolation is the expected pattern on both ends.
- Constant-time comparison; never log the token (redact it from session logs and error output).

**TLS** (`security.tls`):

- Cert/key paths make Bun serve HTTPS directly on the same single port. Clients connect with `https://` when the target uses TLS (auto-detect or a client-side flag — fleet's call, record it).
- No mTLS, no per-agent scopes, no user accounts — explicitly out of scope for this version.

The two features are independent: token without TLS, TLS without token, both, or neither (default).

**Gates and docs impact:**

- E2E coverage extends to the security matrix: token-required server rejecting unauthenticated clients (both POST and SSE), authenticated happy path, and a TLS client↔server run with a self-signed test cert. Same 100% coverage rule applies to the new code.
- README security section updates to: default is plaintext; token + TLS available for the cases where air-gapping alone is impractical; the strongest posture remains network isolation (container, private network, SSH tunnel, reverse proxy).
- Record an ADR: minimal opt-in security layer (bearer token + TLS), plaintext default, rationale as above.
