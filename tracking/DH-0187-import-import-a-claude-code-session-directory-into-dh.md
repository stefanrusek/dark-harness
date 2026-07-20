---
spile: ticket
id: DH-0187
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0188, DH-0189]
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

## Architect design (Fable, 2026-07-18)

**Governing insight — import writes logs, resume replays them.** dh already has a complete
replay half: `--resume <sessionId>` (DH-0038) reads a `.dh-logs/<sessionId>/` directory of
per-agent JSONL files and folds them back into `ProviderMessage[]` (`src/agent/resume.ts`,
`foldEventsToMessages`). So `--import` is deliberately scoped as **a format translator that
produces a valid `.dh-logs/<newSessionId>/` directory**, then hands that session id to the
*existing, unchanged* `--resume` launch path. Import never touches the agent runtime, the
provider layer, or `foldEventsToMessages`. This is the whole reason the design is tractable:
the "resumable" target is already defined by the log schema, and import's only job is to emit
conforming `LogHeader`/`LogEvent` lines. **No `src/contracts/` change is required** — import
reuses the existing `LogLine` union verbatim, so this is architect-designed but is *not* a
§6-item-2 contracts change.

### Decision 1 — Source-location contract: both, disambiguated by path kind

`--import <path>` accepts **either**:
- **(a) a backup-archive directory** (the `session-backup` skill's output): a directory
  containing `manifest.json` — read `id` from it, transcript at `<path>/<id>.jsonl`, optional
  sidecar at `<path>/<id>/`. This is the ergonomic, recommended path. A directory with no
  `manifest.json` but exactly one `*.jsonl` is also accepted (id = its basename).
- **(b) a live single-session `.jsonl` file** (e.g.
  `~/.claude/projects/<slug>/<id>.jsonl`): id = the file's basename, optional sidecar at the
  sibling `<id>/` directory.

**Detection rule:** if `<path>` is a directory → archive mode (require `manifest.json`, else a
lone `*.jsonl`; error clearly if zero or many). If `<path>` is a file ending `.jsonl` → live
mode. **Rejected: accepting a bare live project-slug directory**, because
`~/.claude/projects/<slug>/` holds *many* sessions' `.jsonl` files and cannot disambiguate
which to import — the live case must name the specific `.jsonl`. (The ticket's original
`<directory>` wording is broadened to `<path>` for exactly this reason.) Both are in scope;
neither needs owner sign-off — this is a UX detail inside the scoping remit.

### Decision 2 — Resumability depth: full turn-by-turn replay (not a condensed handoff)

Every user/assistant turn becomes real `LogEvent` lines, so the resumed model sees the actual
prior conversation. This is chosen over a summarized handoff because it is both **higher
fidelity and lower complexity**: the fold machinery already exists, and a condensed handoff
would require inventing a nondeterministic summarization step (an extra LLM call, lossy by
construction, untestable deterministically). Mapping, per agent transcript:

| Claude Code source | dh `LogEvent` |
| --- | --- |
| `type:"user"`, `message.content` text | `message` (role `user`) |
| `type:"assistant"` text block | `message` (role `assistant`) |
| `type:"assistant"` `tool_use` block | `tool_call` (`toolName`, `toolUseId`, `input`) |
| `type:"user"` `tool_result` block | `tool_result` (`toolUseId`, `output`, `isError`) |
| `type:"assistant"` `thinking` block | `thinking` (`content`; `redacted:false`) |
| `message.usage` on an assistant line | `token_usage` (input/output/cache tokens) |
| `type:"system"` line | `message` (role `system`) — kept for diagnostics, **skipped on replay** by `foldEventsToMessages` |

The existing fold already tolerates assistant-with-no-text-but-tool-calls and dangling
`tool_use` repair, so the emitted stream needs no special-casing beyond correct ordering
(source order = timestamp order = emit order).

### Decision 3 — Sub-agent mapping: faithful tree via the `toolUseId` edge

Claude Code represents sub-agents primarily via the **`subagents/` sidecar**: each
`subagents/agent-<ccid>.jsonl` has a companion `agent-<ccid>.meta.json` carrying
`{agentType, description, toolUseId, spawnDepth}`. The `toolUseId` is the *same id* as a
`Task` `tool_use` block in the spawning agent's transcript (confirmed against the real
backup). That is a clean parent→child edge that maps directly onto dh's model (root JSONL +
one JSONL per Agent-tool-spawned sub-agent, each header carrying `parentAgentId`; the parent's
log holds the spawning `tool_call` + `tool_result`).

Mapping:
- Main transcript → **root agent** JSONL (`ROOT_AGENT_ID`).
- Each sidecar subagent → a dh sub-agent JSONL under a **freshly-minted dh `agentId`**;
  `header.parentAgentId` = the dh agentId of whichever agent's transcript contained the
  `Task` `tool_use` whose id equals this subagent's `meta.toolUseId`. `spawnDepth` corroborates
  nesting order (build depth-1 agents first, then deeper, so parents exist before children).
- The parent's `Task` `tool_use` → `tool_call` with `toolName:"Agent"` (dh's tool name) and
  the same `toolUseId`; its `tool_result` → `tool_result`. `meta.description` →
  `header.description`; `meta.agentType` is folded into `instructionsSummary` provenance text.
- Every imported sub-agent gets a terminal `status_change`→`done` (or `failed` if its
  transcript/meta indicates a failure) plus a `completed`/`failed` line — imported sub-agents
  are **historical, finished, and never re-run**.

**Preserved:** full tree shape, per-agent transcripts, parent↔child linkage, human-readable
descriptions — so dh's TUI/web agent-tree view and ADR-0005 diagnostics reconstruct correctly.
**Approximated:** Claude Code's `Task` tool name is rewritten to dh's `Agent`; Claude Code's
`agentType` (`general-purpose`, etc.) has no dh equivalent (dh sub-agents are ad-hoc
model+prompt, CLAUDE.md §4 item 8) so it survives only as description text, not a functional
type. **Dropped:** nothing structural.

**Crucial scope clarification:** dh resume is **root-only** (`resume.ts`), and in dh a root
model only ever sees a sub-agent's *final report* via the `Agent` `tool_result` — never the
sub-agent's internal turns. Therefore importing the sub-agent transcripts is for **tree /
diagnostic / viewing fidelity**, *not* for what the resumed model sees. The resumed model's
prior-context fidelity depends entirely on the **root transcript and its `tool_result`
blocks**, which Decision 2 already preserves verbatim. A minimal correct importer could emit
only the root; the sidecar mapping is what makes the imported session a faithful *diagnostic*
artifact, and is required for parity with a natively-produced dh session.

**Edge cases:** an orphan subagent (`toolUseId` matches no `tool_use`) attaches to the root
with a system-message annotation. Inline `isSidechain:true` branches (Claude Code's older
representation, absent from the sampled backup but must be tolerated) are segregated by
walking `parentUuid` into their own sub-agent JSONL, same as a sidecar subagent. If neither
mechanism is present, the result is a single flat root agent.

### Decision 4 — Lossy-content handling (explicit disposition per line type)

| Source line type | Disposition | Rationale |
| --- | --- | --- |
| `attachment` (hook output / file mentions) | **Preserve textual content** by inlining into the owning user turn's text; binary/image attachments become a `[dh import: <type> attachment omitted]` placeholder | Attachments were model-visible context; text is cheap to keep and improves resume fidelity; binaries can't be faithfully replayed |
| `file-history-snapshot` / `file-history-delta` | **Drop entirely** (not annotated) | Pure Claude-Code-internal undo bookkeeping; never model-visible, no dh analogue |
| `mode` / `permission-mode` | **Drop entirely** | dh has no permission modes — everything is allowed, CLAUDE.md §4 item 7 — so these carry no meaning in dh |
| `last-prompt` | **Drop** | A duplicate of an actual user turn stored for UI recall, not a distinct conversational event |
| `ai-title` | **Consume, don't replay:** use as the imported session's `instructionsSummary`/`description` if present | Cheap, improves how the imported session labels in the tree |
| `bridge-session` / `pr-link` / `queue-operation` | **Drop** | UI/association bookkeeping, non-conversational |
| `system` | **Map to a `system`-role `message` line** (kept in log, skipped on replay) | Preserves diagnostics without polluting the resumed model's context |

Provenance (original session id, original Claude Code model name, source path) is recorded in
the root header's `instructionsSummary` **and** as a leading `system`-role `message` event —
both are diagnostics-only and, because `foldEventsToMessages` skips `system` roles, never
enter the resumed model's context. This is deliberately chosen over adding a header field, so
import stays out of the contracts domain.

### Decision 5 — Model / provider handling

An imported session ran under Claude Code's own model alias (e.g. `claude-sonnet-5`), which
need not match any `dh.json` model entry — and `resume.ts` D3 requires the header `model` to
resolve against the *current* config (unresolvable = clean error, never a silent fallback).
So import **must** stamp a header `model` that is a valid `dh.json` alias. Decision:
- `dh --import <path> --model <alias>` — explicit selection, resolved against `dh.json`.
- If `--model` is omitted, default to `dh.json`'s **`defaultModel`** (the same model a fresh
  `dh` session would use).
- The **original Claude Code model name is preserved as provenance** (in
  `instructionsSummary` + the leading system annotation, per Decision 4) even though it is not
  used as the resume model.

I am treating "default to `defaultModel` when `--model` is omitted" as a **decided,
low-risk, reversible product default** (it mirrors fresh-session behavior and is overridable),
**not** an architect-only call — flagged for the owner in the report. If the owner prefers
import to *require* an explicit `--model` (no silent default), that is a one-line change and
their call; nothing else in the design depends on it.

## User Stories

- **Given** a `session-backup`-style archive directory (containing `manifest.json`,
  `<id>.jsonl`, and an optional `<id>/` sidecar), **when** the operator runs
  `dh --import <dir>`, **then** dh writes a new `.dh-logs/<newSessionId>/` directory whose
  root-agent JSONL is a valid ADR-0005 header + event stream, and prints the new session id.
  *(test: Server — archive-mode detection + root transcript translation round-trips to a
  parseable session directory.)*
- **Given** a live single-session transcript path
  (`~/.claude/projects/<slug>/<id>.jsonl`), **when** the operator runs `dh --import <that
  file>`, **then** dh detects live mode, picks up the sibling `<id>/` sidecar if present, and
  produces the same shape of session directory. *(test: Core — path-kind detection routes file
  vs directory correctly; Server — sidecar discovery from sibling dir.)*
- **Given** an imported session directory, **when** the operator runs `dh --resume
  <newSessionId>` (or import auto-launches it), **then** the model receives a coherent
  prior-turn history folded from the imported root transcript — user turns, assistant turns,
  and tool_use/tool_result pairs in original order. *(test: E2E/Server — import a real backup,
  fold via `replayAgentHistory`, assert message sequence and tool-pair integrity.)*
- **Given** a source session that spawned sub-agents (populated `subagents/` sidecar), **when**
  it is imported, **then** each subagent becomes a dh sub-agent JSONL whose `parentAgentId`
  resolves via the `meta.toolUseId`→`Task` `tool_use` edge, and dh's agent-tree view
  reconstructs the original tree. *(test: Server — sidecar→per-agent-file mapping builds the
  correct parent/child tree, including a depth-2 nesting case.)*
- **Given** a source transcript containing `file-history-snapshot`, `mode`, `permission-mode`,
  `last-prompt`, and `attachment` lines, **when** it is imported, **then** each is handled per
  the Decision-4 table (dropped / consumed / inlined / annotated) and never silently changes
  the replayed conversation in an undocumented way. *(test: Server — one case per lossy line
  type asserting its exact disposition.)*
- **Given** `dh --import <path>` with no `--model`, **when** it runs, **then** the header
  `model` is `dh.json`'s `defaultModel` and the original Claude Code model name is preserved in
  provenance; **given** `--model <alias>`, **then** that alias is stamped and must resolve
  against `dh.json` or import fails cleanly before writing. *(test: Core — default vs explicit
  model selection + unresolvable-alias error path.)*

## Functional Requirements

- FR1 (Core): add `--import <path>` as a top-level mode flag in `src/cli.ts`, alongside
  `--web`/`--server`/`--connect`/`--job`; mutually-exclusive composition rules documented in
  the flag help. `--model <alias>` is an optional companion flag.
- FR2 (Core): path-kind detection — directory ⇒ archive mode (`manifest.json`, else lone
  `*.jsonl`); file ending `.jsonl` ⇒ live mode; anything else ⇒ a clean usage error. Resolve
  the transcript path + optional sidecar path and pass them to the Server importer.
- FR3 (Server): `importClaudeSession(source, opts) → { sessionId, logsRoot }` — a pure
  translation-and-writer module in `src/server/` that mints a new session id, translates the
  root transcript per the Decision-2 table, translates each sidecar subagent per Decision 3,
  applies Decision-4 lossy dispositions, stamps provenance, and writes conforming
  `LogHeader`+`LogEvent` JSONL per agent into `.dh-logs/<sessionId>/`, reusing the existing
  session-write primitives rather than hand-rolling JSONL serialization.
- FR4 (Server): the written directory MUST satisfy `resume.ts`'s validation (header version 1,
  `sessionId` self-consistent, `parentAgentId` chain resolvable) so `--resume` accepts it
  without modification.
- FR5 (Core): model resolution — `--model` if given (must resolve against `dh.json`, else
  fail before any write), else `dh.json` `defaultModel`; stamp it as the root header `model`.
- FR6 (Core): after a successful import, hand `sessionId` to the existing `--resume` launch
  path so the operator lands in a resumable session (TUI/web/headless per the other flags);
  or print the id for a later `dh --resume`. Exact launch-vs-print behavior is a Core detail.
- FR7 (Server): tolerate a truncated final source line and unknown/future Claude Code line
  types (skip-with-annotation, never crash) — same robustness posture ADR 0005 already
  requires of dh's own log readers.

## Domain split

Cleanly sliced into two owner-scoped sub-tickets (interface: the Server importer's
`importClaudeSession(source, opts) → { sessionId, logsRoot }` signature):
- **DH-0188 (Server, Radia):** the format translator + JSONL writer (FR3, FR4, FR7, and all
  of Decisions 2/3/4). This is the diagnostics-critical half that authors dh log files.
- **DH-0189 (Core, Grace):** the `--import`/`--model` flags, path-kind detection, model
  resolution, and wiring the produced session id into the existing `--resume` launch path
  (FR1, FR2, FR5, FR6, and Decisions 1/5). Depends on DH-0188's interface.

DH-0187 remains as the umbrella design record; implementation happens in the two sub-tickets.

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
  coherent prior-turn history), not just "the JSONL parses." Mitigation: the acceptance test
  MUST fold the imported directory through the real `replayAgentHistory`/`foldEventsToMessages`
  and assert message-sequence + tool-pair integrity, against the real backup at
  `~/claude-session-backups/fable-july-18-swarm/`.
- Attachment handling (Decision 4) is the highest-residual-lossiness area: inlining attachment
  text is a best-effort fidelity call, and getting the owning-user-turn association wrong could
  misplace context. The implementer should treat the attachment→user-turn association as its
  own tested case, and if the real backup reveals attachment shapes not covered here, surface
  them rather than silently guessing.

## Open Questions

- ~~Exact source-location contract~~ — **Resolved (Decision 1):** both a backup-archive
  directory and a live single-session `.jsonl` file, disambiguated by path kind. Bare live
  project-slug directories are rejected (multi-session, ambiguous).
- ~~How deep does "resumable" go~~ — **Resolved (Decision 2):** full turn-by-turn replay, not
  a condensed handoff — it is both higher fidelity and lower complexity here.
- ~~What happens to sub-agent sidecar transcripts~~ — **Resolved (Decision 3):** mapped onto
  dh's Agent-tool sub-agent tree via the `meta.toolUseId`→`Task` `tool_use` edge, for
  tree/diagnostic fidelity (the resumed root model's context comes from the root transcript's
  tool_results, not sub-agent internals).
- **Open — for the owner (product, not architect):** should `--import` with no `--model`
  silently default to `dh.json` `defaultModel` (this design's choice), or *require* an explicit
  `--model`? Decided as default-to-`defaultModel` for now (reversible, one-line change);
  flagged for owner confirmation.

## Notes

Filed 2026-07-19 mid-session by the owner ("I have a new feature — --import — it takes a
directory with a Claude session and imports it into dh"). Source-format research done via
the owner's pointer to `~/.claude/skills/session-backup/SKILL.md`,
`~/.claude/skills/session-restore/SKILL.md`, and the one real backup at
`~/claude-session-backups/fable-july-18-swarm/` — see Summary for what was found. Next step:
dispatch Fable (architect-on-call) to do the real scoping pass (concrete mapping design,
fill in User Stories/Functional Requirements) before any implementer picks this up, per the
CLAUDE.md §6 item 4 escalation this ticket is flagged under.
