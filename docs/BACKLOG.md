# Backlog (superseded)

**Superseded by `tracking/` (Spile-format tickets DH-0001 through DH-0007) — kept as-is,
not retroactively restructured, per this project's "don't fix the past" convention.** All
future open-issue tracking happens in `tracking/`; see `tracking/README.md` and
`tracking/views/dark-harness-view.md`. This file's content below is left exactly as it was
at the point of migration, as a historical record.

The durable issue log described in `PLAYBOOK.md` §4.7 — every open item lands here the
moment it's identified, sized to its actual weight. The coordinator re-reads this
periodically and either dispatches a fix directly or brings it back to the owner. Entries
move to "Resolved" (with the commit/round that closed them) rather than being deleted, so
the record of what was open and when stays intact.

---

## Open

### 1. `TASK_FAILED` marker not reliably emitted despite being taught

Confirmed live with gemma-4-31b: given a genuinely impossible task, the model correctly
stated in plain English that it couldn't complete it, but never emitted the literal
`TASK_FAILED` marker the exit-code contract (ADR 0006) depends on — `dh` reported exit code
0 (success) for a self-acknowledged failure. Prompt round 3 added the convention to the
system prompt; it isn't reliably followed by at least this model. Not a code bug — needs
either stronger/more repeated prompt emphasis, or a design rethink (e.g. a more structured
self-report mechanism less dependent on the model remembering an exact string). Owner: Prompt.

### 2. Full MCP client support — ToolSearch/McpAuth are stubs, not the real thing

Scoped as possibly-deferred from HANDOFF.md's start, confirmed still true by Fable's tool-
conformance audit: `ToolSearch` returns one synthetic descriptor per configured MCP server
(no live callable tools, no real `select:`/`+term`/keyword query grammar matching the real
Claude Code convention); `McpAuth` is an honest, documented stub with no real OAuth flow.
This is a substantial feature, not a quick fix — real MCP client support (stdio + HTTP
transports per `dh.json`'s `mcpServers` config, live tool discovery, the real query grammar,
actual OAuth for authenticated servers). Worth a dedicated spec (user stories + acceptance
criteria) rather than a handoff paragraph when picked up, given the scope. Owner: Core
(likely a new `src/agent/mcp-client.ts`-shaped addition), with Prompt's `ToolSearch`
description/query-grammar docs needing to move in lockstep.

### 3. `SendMessage` to a finished agent only errors — doesn't actually resume it

Round 13's fix (P1 item) made this fail loudly instead of silently dropping the message,
which was the urgent half. The real semantics real Claude Code has — continuing a finished
conversation with full context intact — is bigger future work, explicitly scoped out of
round 13. Owner: Core.

### 4. npm packaging only ships a single-platform binary

Known since CI/Release's first round: `package.json`'s `bin` field points at one compiled
binary, so the published npm package only works on whatever platform it was built for —
`bunx dark-harness` doesn't work cross-platform via npm today (GitHub Release binaries are
fine on all 5 targets; only the npm distribution path is narrowed). Needs an owner-facing
packaging-shape decision: per-platform `optionalDependencies` packages (à la esbuild/swc) vs.
a postinstall downloader hitting the GitHub Release assets. Owner: owner's call first, then
whichever of Core/CI-Release the chosen shape lands in.

### 5. `NPM_TOKEN` repository secret not yet set

Owner-authority gap, not something an agent can do: `release.yml`'s `publish-npm` job fails
loudly (rather than silently skipping) if the secret is absent. Needs the owner to add an npm
automation token as the `NPM_TOKEN` repo secret before the first `v*` tag push. Owner: you.

### 6. No dedicated e2e test proves plain multi-turn conversation continuity over real HTTP

Round 5 (Core) fixed and unit-tested multi-turn conversations; the sub-agent e2e coverage
(E2E round 2/5) incidentally exercises two exchanges as part of testing sub-agent spawning,
but there is no e2e test whose actual point is "a root agent, no sub-agents involved, holds a
real second conversation exchange over real HTTP/SSE" — confirmed by grep, no such test
exists. This was live-verified by hand repeatedly this session (by the owner and the
coordinator) but never captured as a real automated e2e scenario. Owner: E2E.

### 7. Server's three Round-1 open threads — likely stale, never explicitly closed

`docs/roster/radia.md`'s Round 1 memory lists three integration open threads (AgentLoopHandle
shape reconciliation against Core's real agent loop, an EventSource+bearer-token escalation
question, and a request to confirm Core's `session_ended` self-report behavior). Given how
much has landed and been live-verified since (Core rounds 2-13, extensive real-model
testing), these are very likely resolved by simple virtue of the system working end-to-end —
but nobody has gone back and explicitly verified and closed them out against current code.
Low-effort check, not a design question. Owner: Server (or the coordinator, as a quick
verification pass).

---

## Resolved

*(Move an entry here, with the closing commit/round, once it's actually done — don't delete
the record of what was open.)*
