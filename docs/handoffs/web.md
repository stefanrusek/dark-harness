# Handoff: Web UI

**Addressed to:** the Web domain lead.
**Owner directory:** `src/web/` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `CLAUDE.md`, ADR 0003 (client-side-only web UI), and `HANDOFF.md` §9 before starting.
This UI is **served by the client process**, never by the headless server (ADR 0003) — it's
a static bundle plus JS that talks to the server over the same HTTP+SSE contract in
`src/contracts/` that the TUI uses (via the browser's native `EventSource` for the SSE side,
`fetch` for commands).

**"Make it a joy to use" is an explicit owner requirement, not decoration** (`HANDOFF.md`
§9) — this is the one domain where visual/interaction polish is genuinely in scope, not
gold-plating. If a frontend-design skill/guidance is available to you, use it.

You do not need the real Server domain running to build most of this — develop against
fixture `ServerSentEvent` streams and a mock `fetch`/`EventSource` in tests. Real
cross-process browser e2e (headless browser driving a real server) is the E2E domain's job.

## Scope

1. **Layout**: tree list of running agents on the left; clicking an agent shows its whole
   output on the right. The root agent's view additionally has an input for sending it
   commands (same `send_message` command the TUI uses).

2. **Required for v1** (`HANDOFF.md` §9):
   - **Status colors** per agent: running / waiting / done / failed (`AgentStatus` in
     `src/contracts/log.ts` — reuse it, don't invent a parallel enum).
   - **Token and cost display**: per-agent and session-total, sourced from `TokenUsageEvent`
     (`src/contracts/events.ts`).
   - **Log download**: single agent's JSONL, or the full session bundle — hits the
     `download_logs` command and triggers a browser download of the response.
   - Live updates via the SSE stream (`EventSource`, honoring reconnect — the browser's
     native `EventSource` already retries and can send `Last-Event-ID` itself on
     reconnect).

3. **Build/serve**: this is a static bundle (HTML/CSS/JS) that the client process serves
   locally — coordinate with Core on exactly how `src/cli.ts`'s `--web` / `--connect --web`
   paths invoke your serving code (e.g. an exported `serveWebUi(port, targetBaseUrl)`
   function). Keep the bundle framework-light — a small, fast, dependency-lean build fits
   this project's "single Bun binary" ethos better than a heavy SPA framework, but this is
   your call to make and document, not a locked decision.

## Constraints

- Import all wire types from `src/contracts/` (the frontend bundle can import the same
  TypeScript types at build time even though it ships as browser JS).
- Stay inside `src/web/`. Cross-domain protocol needs are requests, not forks.
- No auth/session UI beyond the bearer-token mechanism already in `dh.json` — there are no
  user accounts in this version (ADR 0004).

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in src/web/ for the logic layer
                         # (state management, event handling, formatting) — pure rendering
                         # markup is reasonably exempted if your test setup can't drive a
                         # DOM; say explicitly what's covered vs. visually-verified-only.
```
Real browser-driven e2e (headless browser against a real server) is the E2E domain's job,
building on whatever component/logic tests you leave here.

## Definition of done (this round)

- Agent tree + output view renders from a fixture event stream, with correct status colors.
- Token/cost display updates from `TokenUsageEvent`s, per-agent and session total.
- Log download triggers the `download_logs` command correctly for both single-agent and
  full-bundle cases.
- Root agent input produces a well-formed `send_message` command.
- A short design note in your status log: what "joy to use" choices you made (motion,
  layout, palette) and why, so the coordinator/owner can review intentionally rather than
  guess at the reasoning.

## Status log

_(Append dated entries here. Status supersedes.)_
