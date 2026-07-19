---
spile: ticket
id: DH-0187
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0187: --import: import a Claude Code session directory into dh

## Summary

New CLI flag/mode: `dh --import <directory>` takes a directory containing a **real Claude
Code (this very tool's own CLI) session** and imports it into `dh`, producing a **resumable**
dh-native session — not just a viewable transcript — via the normal dh session machinery
(JSONL-per-agent logging, ADR 0004).

**Source format (confirmed 2026-07-19, owner pointed at the session-backup/session-restore
skills and one real backup rather than a fresh guess):** the directory shape is exactly what
`~/.claude/skills/session-backup/SKILL.md` archives — `<id>.jsonl` (the main transcript: one
JSON object per line, fields include `type` [`user`/`assistant`/`attachment`/
`file-history-snapshot`/`mode`/`permission-mode`/`last-prompt`/etc.], `parentUuid` forming a
linked-list conversation chain, `sessionId`, `timestamp`, `message: {role, content}`,
`isSidechain`) plus an optional `<id>/` sidecar directory (`subagents/`, `tool-results/`) for
sessions that spawned sub-agents or had large tool-result payloads. Real example inspected:
`~/claude-session-backups/fable-july-18-swarm/` (2342-line transcript + sidecar).

**Target:** a fully resumable dh session — the user must be able to open it in dh's TUI/web
and continue the conversation with a real model turn, not just read history. This is
materially different from the session-restore skill's job (which just copies files and
rewrites an ID string within Claude Code's *own* format) — this ticket requires translating
Claude Code's conversation model (linked-list `parentUuid` chain, `isSidechain` branches for
sub-agent transcripts, `tool_use`/`tool_result` content blocks) onto dh's own agent-tree model
(root + sub-agents spawned via the `Agent` tool, each with its own JSONL log file, per
ADR 0004's metadata-header + timestamped-events shape). That's a real format-to-format mapping
problem, not a copy.

**Trigger:** new `--import <dir>` top-level flag, alongside `--web`/`--server`/`--connect`/
`--job`.

**Escalation flag (CLAUDE.md §6 item 4):** this writes into dh's own session-log format —
diagnostics-critical, hard to patch after dark-factory runs depend on it, per the same
invariant that already gates ordinary logging-schema changes. An *importer* isn't a schema
change per se, but the design of what it writes (does every imported turn get a synthetic
JSONL entry? how are Claude Code sub-agent sidecars mapped to dh's per-agent files? what
happens to content dh has no equivalent for, e.g. Claude Code's `attachment`/hook-output
lines?) needs an architect pass before an implementer just builds it, so the shape is
deliberate rather than accidentally load-bearing. Route to Fable before implementation.

## User Stories

_To be written once the architect scoping pass below produces a concrete mapping design —
placeholder Given/When/Then bullets before that would just be guessing at the real shape._

## Functional Requirements

- TODO — pending architect scoping pass (see Notes).

## Assumptions

- The imported session was produced by Claude Code itself (this tool), not a different
  product — "Claude session" was confirmed by the owner to mean exactly the format
  `session-backup`/`session-restore` already work with.
- Import should be able to run against either a live `~/.claude/projects/<slug>/<id>.jsonl`
  location or a `session-backup`-style archive directory (`<name>/<id>.jsonl` + `manifest.json`
  + optional `<id>/` sidecar) — needs explicit confirmation which (or both) are in scope.

## Risks

- Lossy/ambiguous mapping: Claude Code's conversation model has concepts dh's doesn't
  (sidechains, hook attachments, file-history snapshots, permission-mode changes) — decisions
  about what's preserved vs. dropped vs. summarized need to be explicit, not silently lossy.
- Because this writes real dh session-log files, a bad importer could produce a session that
  *looks* resumable but corrupts or confuses the agent runtime on resume — needs real
  round-trip testing (import a real backup, resume it, confirm the model actually receives a
  coherent prior-turn history), not just "the JSONL parses."

## Open Questions

- Exact source-location contract (live project dir vs. backup-style archive vs. both) —
  needs owner confirmation.
- How deep does "resumable" need to go — full turn-by-turn history replayed as if it happened
  in dh, or a condensed/summarized prior-context handoff? These have very different
  implementation costs and different fidelity trade-offs.
- What happens to Claude Code sub-agent sidecar transcripts (`<id>/subagents/`) — mapped onto
  dh's own `Agent`-tool sub-agent tree (best fidelity, most complex), or flattened/dropped?

## Notes

Filed 2026-07-19 mid-session by the owner ("I have a new feature — --import — it takes a
directory with a Claude session and imports it into dh"). Source-format research done via
the owner's pointer to `~/.claude/skills/session-backup/SKILL.md`,
`~/.claude/skills/session-restore/SKILL.md`, and the one real backup at
`~/claude-session-backups/fable-july-18-swarm/` — see Summary for what was found. Next step:
dispatch Fable (architect-on-call) to do the real scoping pass (concrete mapping design,
fill in User Stories/Functional Requirements) before any implementer picks this up, per the
CLAUDE.md §6 item 4 escalation this ticket is flagged under.
