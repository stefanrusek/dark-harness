---
spile: ticket
id: DH-0020
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0020: JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O

## Summary

`src/server/logger.ts`'s `appendFileSync` call has no try/catch — on disk-full (ENOSPC),
permission error, or path issues, this throws synchronously inside the `onLog` callback invoked
directly from the agent loop's event emission, which could crash the whole `dh` process (the
opposite of ADR 0005's crash-tolerance intent: the log write failing shouldn't be what kills the
run it's supposed to make diagnosable). Separately, there is no `fsync`/flush after
`appendFileSync`, so the doc comment's claim that "at most the very last write can be lost" is only
true for a process crash, not a full host crash/power loss — the guarantee is overstated. Most
significantly: `SessionLogger.append` writes whatever `LogLine` it's given verbatim, with zero
filtering of `LogToolCallEvent.input`/`LogToolResultEvent.output` for secrets — provider API keys,
credentials a Bash command handles, or MCP server headers can land in the JSONL log unredacted,
and that log is downloadable over HTTP (gated only by the optional bearer token, or not gated at
all in the plaintext default).

## Architect design (Fable, 2026-07-15)

Design pass per CLAUDE.md §6 triggers 1 and 4 (this touches ADR 0004's "never logged"
promise and ADR 0005's durability wording). Three sub-designs below; each User Story's
acceptance criteria are the implementable contract. **No `src/contracts/` change and no ADR
amendment is required** — ADR 0005's consequences already state "Token redaction (ADR 0004)
applies at the log-writing layer, not as a separate scrub pass"; this ticket *implements*
that sentence (verified: no redaction code exists anywhere in `src/` today, so ADR 0004's
"never logged (redacted from session logs …)" is currently an unkept promise).

### D1 — Write-error handling: catch, drop, surface once, note recovery. Never throw, never retry.

`SessionLogger.append` is invoked synchronously from the agent loop's event-emission path
(`server.ts` `onLog` subscription; `cli.ts` standalone `onLogLine`), so a thrown ENOSPC/EACCES
kills the run the log exists to make diagnosable. Decision:

- Wrap the write in try/catch. On failure: **drop the line** (no buffering, no retry) and keep
  per-file state `{ droppedCount, lastErrorCode }`.
- **One-time stderr surface per file**: on the *first* failure for a given log file, write one
  line to stderr with the file path, the error code (e.g. `ENOSPC`), and a note that further
  drops for this file will be silent. Subsequent failures only increment `droppedCount`.
- **Recovery note**: on the first *successful* write to a file that previously dropped lines,
  write one stderr line — "log writing recovered for <path>; N line(s) were dropped" — and reset
  the state. This is the "no silent truncation" rule (CLAUDE.md §8) applied to the logger
  itself: a reader of stderr always learns a gap exists and how big it was.
- Retry rejected: disk-full/permission errors don't resolve between two adjacent appends, and a
  retry loop adds latency inside the synchronous emission path for no realistic benefit.
- An in-log "gap marker" event type was **considered and rejected**: it would be a new
  `LogEvent` variant (a contracts change with reader-tolerance ripple across TUI/Web/analysis
  tooling) to record something stderr already conveys, and it can only be written after
  recovery anyway. Not worth the schema cost; revisit only if dark-factory analysis ever
  genuinely needs machine-readable gap records.
- stderr (not the SSE stream) is the right surface: when the disk is full, the log/SSE machinery
  itself is what's degraded; stderr is the channel that still works. The one-per-file cap keeps
  a TUI-composed process from being spammed.

### D2 — Durability: no per-line fsync; two-tier guarantee, doc comment corrected.

The doc comment's "at most the very last write can be lost" is only true for *process* crash
(kernel page cache survives the process; it does not survive the host). Decision — **do not
add per-line fsync; adopt a cheap two-tier policy instead**:

- **Per-line fsync rejected on cost**: HANDOFF.md's real-run data cites 1309 Bash calls in one
  session; at ≥2 log lines per tool call plus message/token/status lines, a session is
  order-5k–10k appends, each already paying an open/write/close (`appendFileSync` with a path).
  An fsync per line — on macOS effectively `F_FULLFSYNC`-class, milliseconds each — sits
  directly in the synchronous event-emission path of every agent turn, taxing the whole fleet
  to defend against host power loss, a failure mode in which the run is dead anyway and JSONL's
  truncated-last-line tolerance (ADR 0005) already bounds corruption.
- **Tier 1 (all event lines): process-crash-safe.** A completed synchronous append means at
  most the final line is lost/truncated if the *process* dies. This is the guarantee the doc
  comment must claim — no more.
- **Tier 2 (structurally critical lines): host-crash-safe.** Fsync after writing (a) the
  `header` line and (b) terminal lines — `completed`, `failed`, and `status_change` whose
  status is terminal (`done`/`failed`/`stopped`). These are O(agents-per-session), a handful
  of fsyncs total, and they make the two things post-hoc analysis cannot live without — the
  agent tree (first-lines-only reconstruction, ADR 0005) and each agent's verdict — survive a
  host crash. Implementation: for these lines use `openSync`/`writeSync`/`fsyncSync`/
  `closeSync` instead of `appendFileSync`; an fsync failure is handled exactly like a write
  failure (D1), never thrown.
- **Doc comment rewritten** to state both tiers explicitly and name what is *not* guaranteed
  (event-line durability across host crash/power loss).

### D3 — Secrets redaction: at `SessionLogger.append`, on the serialized line; known-value + high-precision patterns.

**Where in the pipeline.** Redaction applies inside `SessionLogger.append` — the log-writing
layer, exactly where ADR 0005 already locates token redaction — **not** at event-emission time
in `loop.ts`. Reasons: (1) the agent's own in-context tool results must stay unredacted (an
agent that deliberately reads a `.env` file needs the real content to do its job), so
emission-time redaction would have to fork raw-for-context vs. redacted-for-log inside Core's
hot path anyway; (2) the JSONL file is the *durable, downloadable-over-HTTP* artifact this
ticket is about — one choke point, guaranteed to cover every line type (tool I/O, message
content, header `instructionsSummary`, failure reasons) with one code path. The live SSE
stream carries the same tool I/O and is *not* redacted by this ticket — it is gated by the
same bearer token/air-gap posture and mirrors agent context for live debugging by design.
That adjacency is noted deliberately: if the owner ever wants SSE redaction, that is a new
ticket, not silent scope growth here.

**Mechanism.** Serialize first, then redact the string, then write:
`write(redactSecrets(JSON.stringify(line), knownSecrets))`. Operating on the serialized JSON
means no per-field walking and no missed nesting. The replacement token `[REDACTED:<label>]`
contains no quotes/backslashes, so substituting it inside a JSON string value always leaves
the line valid JSON.

Two complementary mechanisms, in priority order:

1. **Known-value redaction (exact match) — the highest-severity leak, closed exactly.** The
   harness itself holds real secrets in loaded config: `security.token` (this is the ADR 0004
   promise), every `providers[].apiKey`, and every `mcpServers[].headers` value. These are
   redacted by exact string match (label `[REDACTED:config-secret]`) regardless of format — a
   custom-gateway or LM Studio key with no recognizable prefix is still caught. Match the
   JSON-escaped form of each value (`JSON.stringify(v).slice(1, -1)`) since matching happens
   post-serialization. Guard: skip known values shorter than 8 chars (a pathological 1-char
   "token" must not shred the log). This mechanism is why pattern recall (below) can stay
   conservative: the keys the log-serving process itself holds — the ones an attacker
   downloading logs over plaintext HTTP could immediately reuse against it — are covered by
   construction.
2. **Pattern redaction (high-precision only) — secrets passing through tool I/O that dh does
   not hold.** Fixed, documented table; every pattern must be linear-time-safe (no nested
   quantifiers) and chosen for precision over recall:
   - `sk-ant-[A-Za-z0-9_-]{16,}` — Anthropic API keys / OAuth tokens → `[REDACTED:anthropic-key]`
   - `sk-[A-Za-z0-9_-]{24,}` — OpenAI-style keys → `[REDACTED:api-key]`
   - `\b(AKIA|ASIA)[0-9A-Z]{16}\b` — AWS access key IDs → `[REDACTED:aws-key-id]`
   - `(?i)\b(aws_secret_access_key|aws_session_token)\b["']?\s*[=:]\s*["']?\S+` — value part
     only → keep the key name, redact the value → `[REDACTED:aws-secret]`
   - `(?i)\bauthorization\b["']?\s*:\s*(bearer|basic|token)?\s*\S+` — keep header name and
     scheme, redact credentials → `Authorization: Bearer [REDACTED:auth-header]`
   - `\bgh[pousr]_[A-Za-z0-9]{36,}\b` — GitHub tokens → `[REDACTED:github-token]`
   - `\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` — JWTs →
     `[REDACTED:jwt]`
   - `\bxox[baprs]-[A-Za-z0-9-]{10,}\b` — Slack tokens → `[REDACTED:slack-token]`
   - `\bAIza[0-9A-Za-z_-]{35}\b` — Google API keys → `[REDACTED:google-key]`

   **Considered and rejected:** generic context matching (`password=…`, `secret: …`,
   `api_key = …` with arbitrary values). dh's own dogfooding sessions log Read/Edit/Write tool
   I/O full of source code where `token`/`secret` are ordinary identifiers — a fuzzy context
   pattern would shred legitimate diffs and poison the log's diagnostic value. Precision wins;
   the known-value mechanism (1) already covers the harness's own credentials, which are the
   catastrophic case. The pattern table is explicitly extensible — adding a pattern later is a
   routine Server change, not an architect round-trip.

**Interaction with ADR 0004.** This design *is* the implementation of ADR 0004's
"never logged (redacted from session logs and error output)" for `security.token` — it does
not duplicate or parallel a second mechanism, because none exists yet. No ADR text change
needed; ADR 0005's "token redaction applies at the log-writing layer" consequence is
satisfied as written.

**Module placement / wiring.**
- New `src/server/redact.ts` (Server-owned): `redactSecrets(text: string, knownSecrets:
  readonly string[]): string` and `collectConfigSecrets(config: DhConfig): string[]` (pulls
  `security.token`, provider `apiKey`s, MCP header values; applies the ≥8-char guard).
- `SessionLogger` constructor gains optional `knownSecrets?: readonly string[]`.
- Call-site wiring: `cli.ts` (Core) loads config, so it calls `collectConfigSecrets` once and
  passes the result both into `DhServer`'s options (new optional `knownSecrets` field, threaded
  to its `SessionLogger`) and into the standalone-mode `SessionLogger` it constructs directly.
  `cli.ts` already imports `SessionLogger` from `src/server/` — importing the helper follows
  the same precedent. This is a ~3-line Core follow-through; per CLAUDE.md §3 it is a request
  to Core (Grace), not a Server edit of `src/cli.ts`.

### D4 — Domain assignment and the DH-0040 connection

- **Owner: Server (Radia)** — `src/server/logger.ts`, new `src/server/redact.ts`, tests.
- **Core (Grace) follow-through**: the `cli.ts` wiring above (collect + pass `knownSecrets` at
  its two `SessionLogger`-reaching construction sites). Coordinator sequences Server first.
- **DH-0040 connection (noted, not implemented)**: DH-0040's provider-error-redaction story is
  deferred by owner decision — do **not** build any of it here. But if a real leak is ever
  observed and that story revives as a new evidence-backed ticket, `redactSecrets` in
  `src/server/redact.ts` is the utility it should reuse (Core importing from `src/server/` has
  precedent via `SessionLogger`). Placement in Server rather than a new shared-utils directory
  is deliberate: the ownership map (CLAUDE.md §3) has no shared-utils entry, and inventing one
  for a single speculative consumer is premature; promote the module only when a second real
  consumer exists.

## User Stories

### As an operator, I want a log-write failure to not crash the session it's trying to make diagnosable

- Given any error thrown by the underlying write (ENOSPC, EACCES, EROFS, anything), when
  `SessionLogger.append` runs, then it never propagates an exception to its caller — the line
  is dropped and the failure is counted per file.
- Given the first write failure for a given log file, when it occurs, then exactly one stderr
  line is emitted naming the file path and error code and stating that subsequent drops for
  that file will be silent; later failures for the same file emit nothing.
- Given a file that previously dropped N lines, when a write to it next succeeds, then exactly
  one stderr line reports recovery for that path and the count N, and the per-file failure
  state resets (a later new failure surfaces again).
- Given a write failure, when handled, then no retry is attempted and nothing is buffered.

### As an operator, I want secrets that pass through tool calls to not land in a downloadable log file unredacted

- Given a `LogLine` whose serialized form contains any config-held secret value
  (`security.token`, any provider `apiKey`, any MCP server header value, each ≥8 chars), when
  appended, then every occurrence is replaced with `[REDACTED:config-secret]` before the line
  is written — including occurrences inside tool input/output, message content, and
  `instructionsSummary`.
- Given a `LogLine` whose serialized form matches any pattern in the D3 table, when appended,
  then the matched secret material is replaced with that pattern's labeled token; for the
  keyed patterns (`Authorization`, AWS context pattern) the key name/scheme is preserved and
  only the credential value is redacted.
- Given redaction, when a line is written, then it is still one valid JSON object (replacement
  tokens contain no characters requiring JSON escaping).
- Given ordinary source code containing identifiers like `token`, `secret`, or `password`
  without secret-shaped values, when logged via Read/Edit/Write tool I/O, then it is written
  unmodified (no generic key=value context redaction).
- Given the agent loop's in-context messages and the live SSE stream, when redaction is added,
  then neither is altered — redaction applies only at the log-writing layer.

## Functional Requirements

- Given the logger's doc comment, when rewritten, then it states the two-tier guarantee
  accurately: all lines are process-crash-safe (at most the final line lost/truncated);
  only `header`, `completed`, `failed`, and terminal `status_change` lines are additionally
  fsync'd (host-crash-safe); event-line durability across host crash/power loss is explicitly
  NOT guaranteed.
- Given a `header`, `completed`, `failed`, or terminal-`status_change` line, when written,
  then the write is followed by `fsync` on the same file descriptor before close; an fsync
  failure is handled identically to a write failure (dropped-line accounting + one-time
  stderr), never thrown.
- Given any other event line, when written, then no fsync is performed (per-line fsync is
  rejected — see D2).
- Given `redactSecrets`, when implemented, then every pattern in the table is linear-time-safe
  and covered by a table-driven test (each pattern: at least one positive and one adjacent
  negative case); known-value matching is tested against a value requiring JSON escaping.
- Given the quality gates (CLAUDE.md §5), when this lands, then typecheck/lint/coverage pass
  with 100% coverage on the changed code — write-failure paths exercised by mocking the fs
  layer to throw, fsync behavior by spying on the fs calls; e2e re-run as standard.

## Notes

> [!NOTE]
> Source: Server domain sweep findings #5, #6, #8. Finding #8 overlaps with the security audit's
> finding #13 (provider error messages could leak diagnostic detail) and finding #18 (Bash env
> inheritance) — see **DH-0040** for the Bash/provider-error-message side of the same secrets-
> hygiene theme; this ticket is specifically about the logger's own redaction responsibility.

### 2026-07-17 — gate-check verdict: FAIL

Ran per CLAUDE.md §5/§9 from the worktree root.

- typecheck: PASS
- lint: FAIL — 9 pre-existing errors, all in `.claude/skills/forked-subagent/scripts/*`
  (format/organizeImports); zero lint errors in `src/server/logger.ts` or
  `src/server/redact.ts` (this ticket's changed files). Gate command still exits non-zero
  overall, so per CLAUDE.md §5 this gate fails.
- test:coverage: PASS — 2040 pass / 0 fail; `src/server/logger.ts` and `src/server/redact.ts`
  both 100% funcs/lines.
- e2e: FAIL — 12 failing tests (23 pass / 12 fail) across
  `e2e/markdown-rendering.test.ts` (tmux pane not found), `e2e/server-protocol.test.ts` and
  `e2e/exit-codes.test.ts` (provider callCount mismatches, expected 1 got 2), and
  `e2e/slash-commands.test.ts` (tmux pane not found) — none touch `src/server/logger.ts` or
  `src/server/redact.ts`, but a failing gate command is a failing gate per the prompt's
  strict rule (no averaging).

Acceptance-criteria → test mapping (CLAUDE.md §9): all User Story and Functional Requirement
bullets have a located test in `src/server/logger.test.ts` and `src/server/redact.test.ts`
(write-failure/drop/recovery, fsync tier split, known-value + JSON-escaped redaction,
pattern-table positive/negative cases, non-redaction of ordinary identifiers, valid-JSON
replacement tokens) — criteria coverage itself is COMPLETE. The one FR bullet about the
rewritten doc comment's wording has no corresponding test (it's prose, not behavior);
verified instead by direct inspection of `src/server/logger.ts`'s header comment, which does
state the two-tier guarantee as specified.

**Overall verdict: FAIL** — driven entirely by lint and e2e gate command failures, both of
which are pre-existing/unrelated to this ticket's changed files (`src/server/logger.ts`,
`src/server/redact.ts` are lint-clean and 100% covered). Criteria coverage is complete. Not
this sub-agent's call to fix — routing back per gate-check's design (report only, no
patching).
