# Changelog

All notable changes to `dh` are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver once tagged releases
begin (see `.github/workflows/release.yml`).

## [Unreleased]

Pre-1.0: the project has not cut a tagged release yet. Everything currently in `main` is
"unreleased" — CLI flags, `dh.json` schema, wire protocol, and exit codes are documented as
built (see `README.md` and `docs/adr/`), but are not yet under a semver compatibility
promise until `v0.1.0` ships.

### Notable capabilities as of this entry

- Single compiled binary; server + console TUI + web client composed by CLI flags
  (`docs/adr/0001-single-binary-multi-mode.md`).
- HTTP+SSE client/server protocol, resumable via `Last-Event-ID`
  (`docs/adr/0002-http-sse-protocol.md`).
- Anthropic and AWS Bedrock providers.
- Fixed tool set (`Bash`, `Read`, `Edit`, `Write`, `Agent`, `ToolSearch`, `Skill`,
  `TaskOutput`, `SendMessage`, `Monitor`, `TaskStop`, `McpAuth` — the last is a documented
  stub pending a real MCP client, see `tracking/DH-0002`).
- Ad-hoc sub-agents, arbitrary nesting depth, JSONL-per-agent logging
  (`docs/adr/0005-jsonl-per-agent-logging.md`).
- Optional bearer-token and TLS security (`docs/adr/0004-security-posture.md`); no auth by
  default, air-gapping is the primary intended posture.
- Full user-facing documentation bundle: TUI keybindings, web UI guide, instructions-file
  authoring guide, JSONL log format reference, MCP config examples, skills-authoring guide,
  troubleshooting/FAQ (this changelog's sibling docs under `docs/`).

### Known gaps tracked as open tickets

See `tracking/` (Spile-format `DH-NNNN` tickets, indexed in
`tracking/views/dark-harness-view.md`) for the full list — notably: `TASK_FAILED` reliability
on small/local models (`DH-0001`), no real MCP client yet (`DH-0002`), and no container/
deployment reference doc yet (`DH-0036`).

## How this file will be maintained going forward

Once `v0.1.0` is tagged, entries move under a versioned heading per release
(`## [0.1.0] - YYYY-MM-DD`), and `[Unreleased]` accumulates changes since the last tag. Until
then, this file is a snapshot of "what exists," not a chronological release history — the
project's actual development history (which agent built what, in what order) lives in
`docs/handoffs/*.md`'s dated status logs, not here.
