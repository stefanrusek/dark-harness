# Handoff: Server (HTTP+SSE protocol, session logging)

**Addressed to:** the Server domain lead.
**Owner directory:** `src/server/` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `CLAUDE.md`, ADR 0002 (HTTP+SSE), ADR 0005 (JSONL logging), ADR 0006 (exit codes)
before starting. This domain is the transport and diagnostics layer: it doesn't run the
agent (that's Core) or render anything (that's TUI/Web) — it exposes the agent loop over
HTTP+SSE and writes the session log.

You do not need Core's agent loop to be finished to build most of this. Build the server
against a **minimal fake agent-loop interface** (an object with the shape you'd expect from
`src/agent/loop.ts`'s event-emitter — coordinate the exact shape with the Core domain's
handoff if you land after it; otherwise define a small interface in your own tests and note
it in your status report as a cross-domain integration point to verify once Core lands).

## Scope

1. **HTTP+SSE server** (Bun's built-in `Bun.serve`):
   - `GET` (or similar) SSE endpoint streaming `ServerSentEvent` (`src/contracts/events.ts`)
     as `data:` lines, each with an `id:` field matching `event.id`, supporting resume via
     the incoming `Last-Event-ID` header (replay events after that id from an in-memory or
     on-disk buffer — your call on retention window, document it).
   - `POST` endpoint accepting `ClientCommand` (`src/contracts/commands.ts`) bodies, routing
     each command type to the appropriate action against the running agent tree, returning
     `CommandAck` or the command-specific response (e.g. `AgentTreeResponse`).
   - Default port 4000, overridable via a constructor/start option (the CLI wires
     `--port`).
   - **Never serves the web UI's static assets** — that's ADR 0003. The server is API/event
     protocol only.

2. **Security (ADR 0004)** — implement both, independently togglable via `DhConfig.security`:
   - Bearer token: when `security.token` is set, every request (POST and SSE) without a
     matching `Authorization: Bearer <token>` gets `401` and nothing else. Constant-time
     comparison (don't use `===` on the raw strings — timing side-channel). Never log the
     token value itself, and redact it if it appears in error output.
   - TLS: when `security.tls` is set, serve HTTPS on the same port using the given
     cert/key paths (`Bun.serve` supports this natively via `tls: { cert, key }`).

3. **JSONL-per-agent logging** (ADR 0005):
   - One file per agent under the session's log directory. First line is a `LogHeader`,
     subsequent lines are `LogEvent`s, both from `src/contracts/log.ts`.
   - Writes happen as a side effect of the agent loop's events flowing through the server —
     agents never call a logging tool themselves. Wire this as a subscriber on whatever
     event-emitter interface Core exposes.
   - Must tolerate the process dying mid-write: use append-only writes, one JSON object per
     line, so a truncated last line doesn't corrupt earlier ones.
   - Log download: implement the `download_logs` command (single agent's JSONL, or a
     zipped/tar'd full session bundle when `agentId` is omitted — pick one archive format
     and document it).

4. **Exit-code wiring** (ADR 0006): when running in `--job` mode, the process (composed via
   `src/cli.ts`, which is Core's file — you provide the piece it calls into) exits 0/1 based
   on the agent loop's self-reported success/failure, 2+ on harness error. Expose whatever
   function/hook `src/cli.ts` needs to trigger this; coordinate the exact call shape with
   Core in your status report if it's not obvious.

## Constraints

- Import all wire types from `src/contracts/`. If the event/command schema is missing
  something you need, that's a request to the coordinator, not a local fork.
- Stay inside `src/server/`. Cross-domain needs (e.g. a specific shape from Core's agent
  loop) are stated as requests in your status log, not direct edits to `src/agent/`.

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in src/server/
```
Full real-process HTTP/SSE e2e (including the security matrix: unauthenticated rejection,
authenticated happy path, TLS round trip per ADR 0004/0008) is the **E2E domain's** job, but
write integration tests here too (in-process `Bun.serve` + `fetch`/`EventSource`-equivalent
client) covering the same matrix at the unit/integration level — the E2E domain builds on
top of these, not instead of them.

## Definition of done (this round)

- SSE endpoint streams events and honors `Last-Event-ID` resume, tested against an
  in-process server instance.
- POST endpoint handles all four `ClientCommand` types with correct responses.
- Bearer token and TLS are both implemented and independently tested (on/off/combination).
- JSONL logging writes a valid header + event lines per agent, tested by spinning up a fake
  event stream and asserting on the written files.
- Anything deferred (e.g. log retention window for SSE replay, archive format specifics) is
  documented explicitly, not left implicit.

## Status log

_(Append dated entries here. Status supersedes — read the latest entry before assuming
state from an earlier one.)_
