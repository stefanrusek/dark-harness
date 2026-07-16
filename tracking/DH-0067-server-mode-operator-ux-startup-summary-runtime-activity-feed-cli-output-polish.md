---
spile: ticket
id: DH-0067
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0022, DH-0037, DH-0035, DH-0050]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0067: Server-mode operator UX: startup summary, runtime activity feed, CLI output polish

## Summary

Architect design review (Fable, 2026-07-16) of the headless/operational surface — what an
operator actually sees running `dh --server`, `dh doctor`, `dh logs`, `dh init`, and error
paths. Verified live against the compiled binary. The error-path work is already solid
(red-tinted `dh:`-prefixed messages with actionable hints — e.g. the missing-config error
suggests `dh init`), and `dh logs` already draws a real tree with `├─`/`└─` connectors. But
`dh --server` prints exactly one line at startup and then **nothing, ever** — a message
arrived, a root agent ran a full turn, and the terminal stayed silent; the startup line
names a session UUID but not the log directory, bind address, or how to connect; normal
lifecycle events (SIGTERM shutdown) print in error-red; and `dh logs` renders unknown cost
as a literal `cost=$?`, which reads as a shell-expansion bug. This ticket makes the
headless mode feel like a monitored service instead of a black box.

## User Stories

### As an operator, I want `dh --server` startup output that answers my first three questions

Observed (entire output): `dh: headless server listening on port 4411 (session
81f8e23d-...).` Meanwhile `lsof` shows it bound `*:4411` — all interfaces — with plaintext
HTTP and no auth, and nothing tells me that, where logs land, or what command a client
should run.

- Given `dh --server` starts, when it binds, then print a short startup block: version
  (`formatVersionString` exists in `src/cli.ts`), bind address:port, session id, resolved
  log directory (`.dh-logs/<sessionId>` — the operator's tail target), and a connect hint
  (`dh --connect <host> --port <n>`).
- Given the effective security posture, when plaintext + no token + non-loopback bind
  combine, then say so in one line (`plaintext HTTP, no auth — see README security
  posture`) — this is exactly the ADR 0003/DH-0022 stance that docs must steer operators
  on, and startup is the moment they are looking.
- Given `--web`/local modes, when they print `dh: web UI ready at <url>.`, then include
  the same log-directory line — today the interactive modes never mention it either.

### As an operator, I want a heartbeat of agent activity on the server console

Observed: after startup, a `send_message` command arrived, the root agent started and
completed a turn — zero output. The only way to know anything happened is to already know
where the JSONL logs live.

- Given agent lifecycle events (spawn, status change, terminal status, session end), when
  running `--server`, then emit one concise line each to stdout, e.g.
  `12:04:11 agent-root running (sonnet)` / `12:04:19 agent-root waiting — 1,204 tok /
  $0.0213` — enough to follow along, never full output (that is the clients' and the
  JSONL logs' job).
- Given a noisy fan-out, when many sub-agents run, then keep it one line per transition
  (no streaming text), and consider a `--quiet` flag to restore today's silence; default
  should be informative — an unattended container's stdout is what `docker logs` shows,
  and today that is empty (DH-0050's structured-progress story is the machine-readable
  cousin of this; this ticket is the human-readable one).
- Given a client connects/disconnects from the SSE stream, when it happens, then a dim
  one-liner (`client connected from 127.0.0.1`) — operators repeatedly hit "is my TUI even
  connected?" with nothing on either side to confirm.

### As an operator, I want lifecycle output that doesn't cry wolf

- Given SIGTERM/SIGINT shutdown, when the notice prints (`dh: received SIGTERM; shutting
  down session ...`), then route it in neutral styling — observed it renders in the same
  red as fatal errors because it goes through `io.stderr` (Bun colors stderr red). Expected
  lifecycle events should not look like failures in `docker logs`.
- Given `dh: job complete; starting a new interactive session ...` (the no-`--job`
  transition), when printed, then same treatment — it currently goes to stderr too.

### As an operator, I want `dh logs` and `dh doctor` output I could paste into a report

Observed `dh logs .dh-logs/<id>`: `agent-root [running] cost=$? duration=6ms model=sonnet`.

- Given unknown cost, when formatting (`formatCost` in `src/server/log-analysis.ts:166`),
  then print `cost=—` or `cost=n/a`, never `$?` (reads as an unexpanded shell variable).
- Given a session that ended without a terminal status line (crash/kill), when the tree
  prints `[running]`, then qualify it (`[running?]` or `[running (no terminal event)]`) —
  a dead session claiming to be running undermines trust in the tool.
- Given a TTY, when printing the tree, then colorize status words with the same palette
  the TUI uses (green done / red failed / cyan waiting) — plain pipes stay uncolored
  (standard isatty gate).
- Given `dh doctor`, when reporting per-model results, then align columns and colorize
  `PASS`/`FAIL` on a TTY, and end with a one-line summary (`2 models: 1 pass, 1 fail`) —
  current output is unaligned `PASS <name> (provider "...")` lines with no summary.
- Given `dh logs` with no argument, when sessions exist under `./.dh-logs`, then consider
  listing them (id, start time, agent count) instead of erroring — the operator otherwise
  has to `ls .dh-logs` and copy a UUID.

### As an operator, I want the API port to identify itself

- Given `GET /` on the server port, when probed (curl, load balancer, a confused browser),
  then return a tiny identifying response (`dh server <version>; API at /api; web UI is
  client-served — run: dh --connect <host> --web`) instead of the observed bare 404 — a
  one-line handler that saves every first-time operator a trip to the README.

## Functional Requirements

- All new output goes through the existing injectable `CliIo`/deps seams (`src/cli.ts`)
  and server hooks so it stays unit-testable; 100% coverage per CLAUDE.md §5.
- Startup/activity lines must never print secrets (token values redacted — the DH-0020
  redaction rules apply to console output too).
- No change to the exit-code contract (ADR: 0 / 1 / 2+) or to the machine-parsed
  `web UI ready at <URL>` line's shape (e2e and `spawnDh` grep it) — extend, don't
  rewrite; any change to grepped lines updates `e2e/support/dh-process.ts` in the same
  round.
- The activity feed is stdout-only formatting over events the server already observes —
  no new wire events, no contracts changes.

## Assumptions

- Default-on activity lines (with `--quiet` opt-out) are acceptable for the canonical
  container deployment; if the owner prefers opt-in (`--verbose`), the story flips flag
  polarity but nothing else.
- Bind-address *behavior* (DH-0022, `*:4411` vs loopback default) stays that ticket's
  scope; this ticket only makes the current behavior visible at startup.

## Risks

- Anything greping dh's stdout (e2e `waitForStdout`, operators' scripts) can break when
  startup output grows — keep existing lines byte-stable and add new lines around them.
- Colorizing via Bun's stderr default red is what caused the SIGTERM wolf-cry; the fix
  should set explicit styling rather than relying on stream choice for color.

## Open Questions

- Should the activity feed include per-turn token/cost deltas or only cumulative? (Review
  suggests cumulative at status transitions — cheap and glanceable.)
- `GET /` identification response: plain text or JSON? (Suggest text; humans hit it more
  than machines.)

## Notes

> [!NOTE]
> Filed by the architect-on-call (Fable) from the 2026-07-16 design/UX review. Evidence:
> live runs of the compiled binary — `dh --server --port 4411` (startup line, silent
> runtime, `*:4411` bind via lsof, red SIGTERM notice), `dh logs` (`cost=$?`, stale
> `[running]`), `dh doctor` output shape from `src/cli.ts:runDoctor`, `GET /` → 404, plus
> `dh init`/missing-config/unknown-flag error paths (those are already good — keep them).
