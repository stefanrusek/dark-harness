# Dark Harness — Constitution

This is the project's law. It is short enough to always load, and binding on every agent
that touches this repo. It is the project-specific layer described in `PLAYBOOK.md`
(read that first — it defines the fleet roles, escalation model, and artifact types this
file assumes). The founding product spec is `HANDOFF.md`.

---

## 1. What this is

Dark Harness (`dh`): a single Bun application, compiled to a single binary, that runs an
LLM agent (and sub-agents) with a minimal Claude-Code-mirrored tool set, skill/MCP support,
and both console and web UIs. See `HANDOFF.md` for full product scope.

## 2. Stack

- **Runtime/toolchain:** Bun (>=1.3). TypeScript throughout, strict mode.
- **Single package**, not a multi-package workspace — `dh` ships as one compiled binary, so
  ownership is enforced by directory convention (below), not package boundaries.
- **Testing:** `bun test` (built-in). Coverage via `bun test --coverage`.
- **Compilation:** `bun build --compile` for release binaries (linux/macos x64+arm64,
  windows-x64).

## 3. Repository layout / ownership map

Each directory has one owning domain. Handoffs are scoped to one owner; cross-boundary
needs are requests to the other owner, never a direct edit (PLAYBOOK.md §5).

| Path | Owning domain | Contents |
| --- | --- | --- |
| `src/contracts/` | **Contracts** (shared — changes need architect sign-off, see §6) | SSE event schema, POST command schema, log-line schema, `dh.json` schema, exit codes. The single source of wire truth. Every other domain imports from here; nothing redeclares a wire type locally. |
| `src/agent/`, `src/config/`, `src/cli.ts`, `scripts/` | **Core** | Agent loop, tool implementations (Bash, Read, Edit, Write, Agent, ToolSearch, Skill, TaskOutput, SendMessage, Monitor, TaskStop, McpAuth), provider adapters (anthropic-type, bedrock-type), `dh.json` loading/validation + `$(VAR)` interpolation, the CLI entry point (flag parsing, mode composition: `--web`, `--server`, `--connect`, `--job`, `--instructions`, `--config`, `--port`), and build tooling (`scripts/build.ts`, which stamps build identity into the compiled binary — see ADR 0005's amendment). |
| `src/server/` | **Server** | HTTP+SSE server, protocol handlers, JSONL-per-agent session logging, exit-code contract. |
| `src/tui/` | **TUI** | Console client: alt-screen full-screen TUI, root view + agent tree, SSE client parsing. |
| `src/web/` | **Web** | Web UI: served client-side only, agent tree, status colors, token/cost display, log download. |
| `src/prompt/`, `README.md` | **Prompt** | Built-in system prompt, skill enumeration, bundled CLI-tools skill, and the project README (landing page). |
| `e2e/` | **E2E** | Real-binary end-to-end tests: PTY harness for TUI, headless browser for web, HTTP/SSE across processes, mock provider endpoint. Sequenced after the other domains land. |
| `docs/adr/` | Coordinator | Locked decisions. |
| `docs/handoffs/` | Coordinator | Domain handoff documents. |
| `docs/design/` | **Design crew** (persistent, cross-cutting — see §7) | Durable, reusable design-system reference: visual/interaction language, terminology, and UX principles shared across TUI/Web/CLI output. Ticket-scoped spikes, mockups, and one-off research belong in that ticket's Spile sidecar directory instead (`tracking/DH-NNNN-slug/`, per `SPILE-SPEC.md` — nothing normative lives there); only decisions meant to be *reused* graduate here. |
| `docs/BACKLOG.md` | Coordinator | Superseded historical record — see `tracking/`. |
| `tracking/` | Coordinator | Durable issue log (PLAYBOOK.md §4.7), Spile-format (`DH-NNNN` tickets). All open-issue tracking going forward; see `tracking/README.md`. |
| `.github/workflows/` | **CI/Release** | CI gate, tag-driven release/publish. |

## 4. Invariants (locked decisions — reference the ADR, do not relitigate)

1. One binary, two logical processes (server, client) composed by flags. Web UI is
   **always client-served**, never by `--server`. See `docs/adr/0001-single-binary-modes.md`.
2. Client↔server protocol is **HTTP + SSE**, not WebSocket. Versioned JSON events, resumable
   via `Last-Event-ID`. See `docs/adr/0002-http-sse-protocol.md`.
3. **Plaintext HTTP by default, no auth.** Optional `security.token` (bearer, constant-time
   compare, never logged) and `security.tls` (cert/key) are opt-in via `dh.json`. Air-gapping
   remains the primary posture. See `docs/adr/0003-security-posture.md`.
4. **JSONL-per-agent logging**: one file per agent, first line is a metadata header (session
   id, agent id, parent agent id, spawn timestamp, model, instructions summary/hash),
   subsequent lines are timestamped events. Logs are automatic — agents never call a logging
   tool. See `docs/adr/0004-jsonl-logging.md`.
5. **Exit codes:** `0` success, `1` self-reported task failure, `2+` harness error. See
   `docs/adr/0005-exit-code-contract.md`.
6. **`dh.json` schema** (models/providers/options/skillPaths/mcpServers/systemPrompt/
   security) is as specified in `HANDOFF.md` §5 and Addendum B — extend minimally, never
   restructure without an ADR. See `docs/adr/0006-dhjson-schema.md`.
7. **Permissions: everything is allowed, always.** No approval prompts, no permission modes.
   Documentation must steer operators toward air-gapped deployment. See
   `docs/adr/0003-security-posture.md`.
8. **Sub-agents are ad-hoc only** — no named/predefined agent definition files; `Agent` takes
   a model name + prompt; arbitrary nesting depth; `run_in_background` defaults to `true`
   everywhere, overridable in config.

## 5. Quality gates (hard rules — CI fails below these)

Run before any commit is considered done; the exact commands are the contract implementers
are judged against (PLAYBOOK.md §4.5):

```
bun run typecheck      # tsc --noEmit
bun run lint            # biome check .
bun run test:coverage   # bun test src --coverage; 100% coverage is a gate, not a target
bun run e2e             # bun test e2e; real compiled binary, PTY + headless browser + mock provider
```

100% coverage applies to new/changed code in every PR. E2E spawns the **real compiled
binary** in each run mode against a **mock Anthropic-compatible provider endpoint** — never
the real API in the gate.

## 6. Escalation triggers (tuned for this project)

The coordinator calls the architect-on-call (Fable) when — and only when — a task hits:

1. Anything that would set, change, or bend an invariant in §4 or a `docs/adr/` entry.
2. A change to `src/contracts/` (the wire truth) — shared-schema edits are architect-reviewed
   before other domains build against them.
3. A decomposition that can't be cleanly sliced by the ownership map in §3.
4. Anything touching the security posture (§4.3), the exit-code contract, or the logging
   schema (diagnostics-critical, hard to patch after dark-factory runs depend on it).
5. Two domains' outputs conflicting and needing arbitration.
6. Anything the coordinator or a domain lead notices it is guessing at.

Everything else is a routine coordinator call. Authority/taste/credentials questions (npm
publish rights, GitHub repo settings, cutting the v0.1.0 release) route to the owner, not
the architect.

## 7. Roster and agent memory

Every `Agent` spawn is a **fresh process with no memory of prior runs** — a "persistent"
named role only survives across invocations if the repo carries it forward. Two artifacts
do that job together:

- **This table** — the lightweight index: who exists, pronouns, role, persistence.
- **`docs/roster/<name>.md`** — one memory file per persistent agent. Not a duplicate of a
  handoff's dated status log (which records *what got built, task by task*) — this is the
  durable, identity-level record: judgment calls and why, conventions adopted, open threads,
  anything a fresh instance resuming "itself" would otherwise have to re-derive from scratch.

**Convention for resuming a named role:** read `docs/roster/<name>.md` first (if it exists),
then the relevant handoff(s) and their latest status-log entries, then do the work. Before
ending your turn, append a dated entry to your own roster file's Memory section, and update
your row below if anything changed. First time coming online under a chosen name: create
`docs/roster/<name>.md` using the template below and add yourself to the table.

Roster file template:

```markdown
# Roster: <Name> — <role>

**Pronouns:** ...
**Role:** ...
**Persistence:** persistent | ephemeral
**Owns:** <directories>
**Handoffs:** <links to docs/handoffs/*.md this role works from>

## Memory

### <date> — <round/topic>
<durable notes: judgment calls and why, conventions adopted, open threads>
```

| Name | Pronouns | Role | Persistence | Memory |
| --- | --- | --- | --- | --- |
| Ada | she/her | Coordinator | Persistent for this build (this session) | (this session; no separate file yet) |
| Iris | she/her | Prompt domain lead (`src/prompt/`, `README.md`) | Persistent | `docs/roster/iris.md` |
| Radia | she/her | Server domain lead (`src/server/`) | Persistent | `docs/roster/radia.md` |
| Mary | she/her | TUI domain lead (`src/tui/`) | Persistent | `docs/roster/mary.md` |
| Nightingale | she/her | CI/Release domain lead (`.github/workflows/`) | Persistent | `docs/roster/nightingale.md` |
| Grace | she/her | Core domain lead (`src/agent/`, `src/config/`, `src/cli.ts`) | Persistent | `docs/roster/grace.md` |
| Susan | she/her | Web domain lead (`src/web/`) | Persistent | `docs/roster/susan.md` |
| Hedy | she/her | E2E domain lead (`e2e/`) | Persistent | `docs/roster/hedy.md` |
| Muriel | she/her | Design crew lead — cross-cutting UX/polish (`docs/design/`; see below) | Persistent | `docs/roster/muriel.md` |

Domain leads/implementers are spawned ad hoc per handoff and name themselves on arrival;
this table grows as they come online. Architect-on-call is Fable, invoked per §6 — not a
standing instance, no roster file needed.

**Design crew** (persistent, Fable-tier) is the one exception to "architect isn't a standing
instance": it owns the felt experience of using `dh` — TUI, Web, and CLI output — end to end,
with a free hand to look across all of it at once rather than being scoped to one ticket's
checklist. It **designs and writes fully-detailed tickets**; it does not implement.
Implementation stays with the normal domain owner per §3 (Mary for TUI, Susan for Web, Grace
for CLI/Core output, Radia for anything server-driven). This split exists because narrowly-
scoped polish tickets have repeatedly produced narrowly-correct-but-lifeless results (see
DH-0095, DH-0098, DH-0099) — a ticket written to one subsystem's spec can satisfy that spec
and still miss the experience of actually using the tool. Durable, reusable design decisions
(visual language, interaction conventions, terminology) belong in `docs/design/`; ticket-
scoped spikes and mockups belong in that ticket's own Spile sidecar directory instead
(`tracking/DH-NNNN-slug/`) and are not authoritative beyond that ticket.

## 8. Workflow rules

- Directory ownership (§3) is the primary collision-avoidance mechanism.
- Commit before you yield — never leave a dirty tree for another agent to trip on.
- Status supersedes: a later report from the agent doing the work overrides earlier
  assumptions, including the coordinator's.
- No silent truncation: if an agent caps its coverage (top-N, sampling, deferred scope),
  it says so explicitly in its report.
- PRs: optional per task; the coordinator (Ada) is responsible for merging.

## 9. Acceptance criteria → verification (TDD/BDD)

This project commits to a stronger TDD/BDD discipline: a ticket's User Stories are already
written in Given/When/Then form (BDD's native shape) — closing the loop means each of those
bullets must correspond to an actual executable test, not just prose that reads like one.
"Done" is a claim the test suite proves, not a claim an implementer or the coordinator
asserts.

- **Unit/component test** (`bun test src`, the existing 100%-coverage gate) is the default
  home for any criterion exercisable against mocked providers/deterministic state.
- **Integration test** (a new tier — real network calls against real provider APIs) is
  required for any criterion that can only be verified against real model behavior: a
  model's actual tool-calling reliability, a real Bedrock/Anthropic response shape, anything
  the mocked e2e suite structurally can't see. E2E's existing mock-provider-only policy (§5)
  is unchanged — this is an additional tier, not a loophole in it.
  - Cost/scope: acceptable for haiku-class models and cheaper, for now (owner decision,
    2026-07-16). Don't default this to pricier tiers without asking.
  - Not part of the default `bun run test:coverage`/CI gate (real calls cost money, need
    live credentials) — but must exist, be checked in, and be re-runnable on demand.
  - Location, ownership, and CI wiring are still open — to be settled before this tier's
    infrastructure is built (as of 2026-07-16: not yet decided whether these live under a
    new top-level `integration/` directory or a gated subfolder of `e2e/`, who owns the
    harness vs. individual test cases, and whether they ever run in CI at all given the
    security-posture implications of real API credentials — see §4.3 — of doing so).
- A ticket cannot move to `closed` without each User Story bullet naming the specific test
  (file + case) that proves it. A prose "I manually verified this" is no longer sufficient
  close-out evidence.
