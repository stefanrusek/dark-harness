# ADR 0005: JSONL-per-agent session logging

**Status:** Accepted

## Context

Diagnostics and dark-factory optimization depend on being able to reconstruct exactly what
every agent (root and sub-agents, arbitrary nesting depth) did in a session, after the fact
and potentially while other agents are still running concurrently.

## Decision

- Every session creates a **log directory**.
- **One JSONL file per agent.**
- The **first line of each file is a metadata header**: at minimum session id, agent id,
  parent agent id (`null` for root), spawn timestamp, model name, and an instructions/prompt
  summary or hash. A tool reading only first lines across all files in a session directory
  can reconstruct the full timeline and agent tree without parsing event bodies.
- Subsequent lines are timestamped events: messages, tool calls and results, token usage,
  status changes, completion/failure — sufficient to replay an agent's full activity from
  its file alone.
- Logging is **automatic**: agent actions and output flow to these logs as a side effect of
  the harness; agents never call a logging tool themselves.

## Consequences

- The header schema is part of `src/contracts/` — any field addition/removal is a
  contracts-domain change (CLAUDE.md §6 escalation trigger 2), because external tooling
  (dashboards, dark-factory analysis scripts) will parse first-lines-only.
- Log writing must be robust to a session ending mid-write (crash, kill) — readers should
  tolerate a truncated final line.
- Token redaction (ADR 0004) applies at the log-writing layer, not as a separate scrub pass.

## Amendment (2026-07-15): `client` and `build` on the header

Prompted by a real diagnostic gap: a hung session with no way to tell which client (TUI vs.
Web) or which build produced it. Approved design (Fable, architect-on-call), implemented in
Core round 8:

- `LogHeader` gains **`client: "tui" | "web" | "server" | "none"`** — a one-shot fact
  captured at session start describing how *the log-writing process* was invoked (per ADR
  0001's mode composition), not an attempt to track every remote client that connects to a
  `--server` process over its lifetime (that has no single authoritative answer and isn't
  attempted — `"server"`'s doc comment says so explicitly).
- `LogHeader` gains **`build: { version, gitSha, dirty, releaseTag }`** — build identity
  stamped into the compiled binary at build time via `bun build --compile --define`
  substitution (a new `scripts/build.ts` wrapper all three build call sites — `package.json`,
  `release.yml`, `e2e/support/build.ts` — now invoke instead of calling `bun build` raw).
  `gitSha`/`releaseTag` are `null` for an unstamped build (running from source, or a raw
  `bun build --compile` that bypassed the script) — `version` (from `package.json`) is always
  present.
- Both fields are **required** on every newly-written header. Readers of older log files
  (written before this amendment) must tolerate their absence — this is an additive,
  backward-compatible-to-read schema change, not a version bump of the header format itself.
- `scripts/` is Core-owned (added to `CLAUDE.md` §3's ownership map).
