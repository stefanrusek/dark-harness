---
spile: ticket
id: DH-0038
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0003]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0038: No crash-recovery/session-resume across a process restart, and a completed standalone job silently starts a fresh, disconnected interactive session

## Summary

Every session gets a fresh `sessionId` and a fresh in-memory `AgentRuntime`; there is no
`--resume <sessionId>` flag and no code path that reconstructs conversation state from an existing
`.dh-logs/<id>` directory. If a container OOMs, is preempted, or the process is killed mid-run, all
agent context (conversation history, partial progress) is lost — for an "hours-long unattended"
primary use case, this is a substantial availability gap; the only recourse today is re-running
`--instructions` from scratch. Separately, and more immediately confusing: after a standalone
`--instructions` run without `--job` completes, `main()` starts a **new**, empty interactive
session rather than continuing the one that just ran — explicitly noted in-code as "not a
continuation" but invisible to the operator watching stdout, who sees the final output print and
then silently gets a fresh, contextless session with no explicit message explaining what happened.

## User Stories

### As an operator, I want a crashed/restarted session to be resumable, not a total loss

- Given a session directory with existing JSONL logs, when `--resume <sessionId>` (or similar) is
  passed, then conversation state is reconstructed from the logs and the run continues.

### As an operator running a standalone job without `--job`, I want to be told explicitly that the follow-up interactive session doesn't share context with the job that just ran

- Given a completed `--instructions` run (no `--job`), when the process continues into interactive
  mode, then it prints an explicit message ("job complete; starting a new session — prior context
  is not preserved") rather than silently swapping to a disconnected session.

## Design — `--resume <sessionId>` (Fable, architect-on-call, 2026-07-15)

Scope note: this design covers only the substantial half (crash recovery via `--resume`). The
other half — the explicit "job complete; starting a new session" message — is being implemented
directly by Core in parallel and is deliberately not designed here; nothing below depends on or
constrains that message's wording or flow.

### D1. Reconstruction mechanism: replay the root agent's JSONL event stream

Reconstruction is a **replay of the root agent's log file** (`<logDir>/agent-root.jsonl`,
i.e. `ROOT_AGENT_ID` percent-encoded per `SessionLogger.filePathFor`) back into an equivalent
in-memory `ProviderMessage[]`. There is no saved state blob and none is introduced — the JSONL
event stream is already the durable record (ADR 0004/0005), and a second serialization format
would just be a second thing to keep consistent.

Fold rules (events in file order, tolerant of skipped/corrupt lines exactly like
`log-analysis.ts`'s `parseJsonlFile`):

- `message` role `user` → push `{ role: "user", content: [{ type: "text", text }] }`. (Both the
  initial instruction and every injected `pendingMessages` batch are logged this way — see
  `loop.ts`; no distinction needed on replay.)
- `message` role `assistant` → open an assistant message with one text block.
- `tool_call` → append a `tool_use` block (`id: toolUseId`, `name: toolName`, `input`) to the
  current assistant message, **opening one if none is current** — an assistant turn with tool
  calls but zero text emits no `message` event at all (`loop.ts` only logs assistant text when
  `text.length > 0`), so `tool_call` must be able to start the assistant message itself.
- `tool_result` → append a `tool_result` block to a pending user message that is flushed before
  the next assistant/user event. `output` is logged as `unknown` but is always a string in
  practice (`runToolCalls` logs the same `output: string` it puts in the provider block);
  replay stringifies defensively (`typeof output === "string" ? output : JSON.stringify(output)`).
- `message` role `system` → **skipped**. System-role log lines (budget-trip notices, orphaned
  completion-notification records, "root agent failed to start") are log annotations that were
  never part of the model's context (`ProviderRole` is only `user | assistant`); replaying them
  into history would fabricate context the model never saw.
- `token_usage`, `status_change`, `completed`, `failed`, `header` → not conversation content;
  skipped for history purposes (but see D3/D6 for how `header` and terminal events are used).

Two normalization rules make the result API-valid for both provider adapters:

1. **Dangling `tool_use` repair.** Any `tool_use` block with no matching `tool_result` event
   (crash mid-tool-execution — the `tool_call` line is Tier-1-durable, the result never got
   written) gets a synthesized
   `{ type: "tool_result", toolUseId, content: "[dh: interrupted — the harness restarted before this tool call completed; its outcome is unknown]", isError: true }`
   in the immediately-following user message. Without this, the reconstructed history is
   rejected by the provider (every `tool_use` requires a paired `tool_result`).
2. **Trailing-role merge.** The resume wake-up message (D3) is appended as a new user message
   when the history ends with an assistant message, or merged as an extra text block into the
   final user message when the history already ends with role `user` — never two adjacent
   same-role messages, so no provider-side alternation assumption is tested.

Fidelity caveat, stated up front: the reconstruction is **semantically equivalent, not
byte-identical**. The log flattens an assistant turn's content-block ordering (all text is
joined by `textOf()` into one `message` event, logged before its `tool_call` events), so replay
canonicalizes every assistant turn to "one text block, then tool_use blocks in call order".
Multiple/interleaved text blocks are collapsed. This is fine for a resumed conversation and is
not worth a log-schema change to fix.

**Scope: root agent only, v1.** Sub-agents restart fresh; their logs are read only to *name*
what was lost (see D3), never to reconstruct their conversations. Rationale:

- The root's reconstructed history already contains every sub-agent result that was delivered
  before the crash (as `tool_result`s of blocking `Agent` calls, or as injected
  completion-notification user messages for background ones — `handleTaskSettled` delivers via
  the same logged `sendMessage` path).
- A sub-agent's surrounding machinery is inherently unreconstructible: `TaskRegistry` entries,
  AbortControllers, `sendMessage` sinks, output buffers, and any background Bash *processes*
  died with the process. Reviving the conversation without the machinery produces a zombie.
- The resumed root can simply re-spawn any sub-agent whose work didn't complete — spawning is
  cheap and ad-hoc by design (invariant §4.8), and the sub-agent's durable work products
  (files on disk, commits) survived the crash anyway.

**Resume chains.** A resumed session's own log directory contains only post-resume events (D4:
history is not re-logged), so resuming a session that was itself resumed must walk the
`resumedFrom` header chain (D4) oldest→newest and replay each directory's root file in order,
concatenating. Cycle/missing-link handling per D6. The chain walk is bounded (each hop is one
directory read) and expected to be short in practice.

### D2. What is NOT reconstructible (acceptance criteria must not overclaim)

Genuinely lost across a process restart, regardless of design:

1. **In-flight tool execution and its side effects' completeness.** A Bash command running at
   crash time may have partially executed; the synthesized error `tool_result` (D1) marks the
   *call* as interrupted but nobody knows what the command actually did. The resumed agent must
   re-verify, not assume.
2. **All sub-agent in-memory state** (running conversations, task output buffers, pending
   steering messages) and **all background Bash processes** — the OS processes are gone (or
   orphaned outside dh's knowledge; DH-0011's process-group scope applies).
3. **Messages queued but not yet injected.** `pendingMessages` are only logged at injection
   time (top of the next turn, `loop.ts`); a message sent while a turn was in flight, lost to
   the crash before injection, left no trace.
4. **Lines the logger dropped or lost.** DH-0020 D1 drops lines on write failure (ENOSPC etc.,
   stderr-noted once), Tier 1 durability permits loss/truncation of the final line on a process
   crash, and *host*-crash/power-loss can lose any non-fsynced ordinary event line. Replay is
   tolerant (skips unparseable lines, repairs dangling tool_uses) but cannot recover content
   that never hit disk.
5. **Session budget counters and turn count** (DH-0013's cumulative cost/tokens/wall-clock,
   `loop.ts`'s `turns`). Deliberately **reset** for the resumed run — it is a new session
   (D4) with its own budgets. Re-deriving spent cost from old `token_usage` lines is possible
   but out of scope for v1; if an operator wants a combined cap they can lower the config
   values. Documented, not accidental.
6. **Redacted values** — see D5. Irrecoverable by construction; that is redaction working.

Provider-side state is not on this list: the Messages API is stateless per request, so a
well-formed reconstructed history is all that's needed.

### D3. CLI semantics

`dh --resume <sessionId>` — a value flag, added to `FLAGS_WITH_VALUES`, composing with the
existing mode flags:

- **Config/instructions are loaded the normal way** (`--config`, default `./dh.json`; `--env`
  as usual). Resume does **not** load "the original session's effective config" — the config
  is deliberately never written to the logs (it holds secrets; ADR 0004 "never logged"), so
  there is nothing to load it *from*. The operator runs `--resume` from the same working
  directory (that's also where `.dh-logs/` resolution happens) with whatever config is current.
  Config may therefore legitimately differ from the original run (e.g. a raised budget).
- **Model:** the resumed root uses the **original root header's `model` alias, resolved against
  the current config**. If the alias no longer exists in `models[]`, that is a clean startup
  error naming the missing alias and the known models (same shape as `ConfigModelError`) — not
  a silent fallback to `defaultModel`, which could quietly continue an hours-long run on the
  wrong model. Resuming under a *different* model is achievable today by editing the alias's
  `model`/`provider` fields in config (alias stays, target changes); a dedicated override flag
  is out of scope for v1.
- **`--instructions <file>` combines with `--resume`:** the file's content becomes the
  post-resume user message (appended per D1's trailing-role merge, after the standard resume
  preamble). Without `--instructions`, a synthetic resume notice alone wakes the root:
  it states that dh restarted, that the conversation was reconstructed from logs, that any
  in-flight tool calls/background tasks/sub-agents did not survive (listing non-terminal
  agents by id/description via DH-0037's `readSessionLogSummaries` over the resumed
  directory — status still `running`/`waiting` at crash time), that `[REDACTED:...]`
  placeholders in history must be re-read from source if needed (D5), and to verify
  partially-completed work before continuing. This notice is Core-owned runtime text (same
  category as `handleTaskSettled`'s completion notifications), not a Prompt-domain artifact.
- **Mode composition:** `--resume` works with the standalone path (`--instructions`/`--job` —
  the primary crashed-dark-factory use case) and the local/server interactive modes (the
  runtime is constructed with the reconstructed history; the root starts on the first message
  exactly as today, seeded). `--resume --connect` is rejected with the same "not supported
  with --connect" shape as `--instructions --connect` — there is no wire command for it, and
  the logs live on the server's filesystem anyway.
- **Resuming a *completed* session is allowed**, not an error — continuing a finished
  conversation with new instructions is a legitimate use (and composes with the parallel
  message-fix: a natural follow-up to a completed standalone job). The terminal
  `completed`/`failed` event is simply where the replayed history ends.
- **`<sessionId>` resolution:** a bare session id, resolved to `./.dh-logs/<sessionId>` (same
  root the writers use). Not a path in v1; the error message names the directory it looked for.

Plumbing: `cli.ts` reads the chain and calls the replay (see D7 for who owns what), then passes
`resume: { messages, fromSessionId }` into `AgentRuntimeOptions`; `AgentRuntime.runRoot` threads
it into `runAgentLoop` as a new optional `AgentLoopParams.resume` — the loop seeds `messages`
from it instead of starting from the bare instruction, and stamps the header per D4. No change
to the loop's turn mechanics, self-report convention, or interactive/waiting semantics.

### D4. New session, new directory — never append to the old one

A resumed run gets a **fresh `sessionId` and fresh `.dh-logs/<newId>/` directory**. The new
root header carries a new optional field:

```ts
/** Present iff this agent's conversation was reconstructed via --resume; names the session
 * it continued. Additive/optional — readers tolerate absence (same pattern as
 * `description`); absent on every non-resumed agent and every pre-DH-0038 log. */
resumedFrom?: { sessionId: string };
```

This is a `src/contracts/log.ts` change and per §6.2 needs architect sign-off — granted by this
design (additive optional header field, backward-compatible-to-read, no version bump; exactly
the ADR-0005-amendment pattern `client`/`build` used).

Why not continue writing into the old directory:

- **One-header-per-file invariant.** `LogLine`'s contract and every reader (DH-0037's
  `summarizeFile`, the tar download, retention) assume header-first, one header, one writer
  lifetime per file. Appending a second life into `agent-root.jsonl` — possibly right after a
  torn, truncated final line from the crash (Tier 1 explicitly permits this) — breaks parsers
  and splices new JSON against a corrupt tail.
- **DH-0020's durability reasoning is per-writer-lifetime.** The failure-state tracking, fsync
  tiers, and "at most the last line" claims all assume a single `SessionLogger` owning the file
  from creation. A second process appending re-opens exactly the write-ordering/corruption
  questions DH-0020 just closed. A fresh directory means `SessionLogger` needs **zero changes**.
- **Sessions stay immutable audit units.** Retention pruning, `dh logs`, and log download all
  treat a session directory as a finished artifact; the `resumedFrom` chain preserves the full
  story across directories, and `dh logs` can later learn to follow it (nice-to-have, not part
  of this ticket's gate).

Consequence, stated explicitly: the reconstructed prior history is **not re-logged** into the
new directory (thousands of duplicated lines, re-passed through redaction, for no diagnostic
gain). The new root file starts at the header (+`resumedFrom`) and the resume notice message;
anyone wanting the pre-crash transcript follows the chain. This is what makes the D1 chain walk
necessary and is the accepted trade.

### D5. Redaction interaction: real, acceptable, one sentence of handling

Real constraint, not a non-issue: DH-0020 D3 redacts at the log-writing layer, so the
reconstructed history differs from the original in-memory history wherever a known config
secret or a pattern-matched token passed through logged content — the resumed agent sees
`[REDACTED:anthropic-key]` etc. where the live agent once had real values.

Accepted for v1 with no un-redaction mechanism (there is nothing to un-redact *from* — the
values never reached disk; that is the feature). Consequences and handling:

- Mostly harmless: the placeholders are opaque strings; the model reads past them.
- Failure case: a task that carried a secret in-context (read a token, was about to use it)
  resumes with a hole. The resume notice (D3) explicitly instructs re-reading such values from
  their source. No further mechanism.
- Security property preserved in both directions: resume never reintroduces secrets into the
  new log (the new `SessionLogger` redacts with the *current* config's `collectConfigSecrets`
  as usual), and a `[REDACTED:...]` placeholder echoed by the resumed model stays redacted-shaped.

### D6. Failure modes — clean, actionable errors, exit code 2 (HarnessError)

All resume-startup failures route through the existing `fail(io, ...)` path — one
`dh: cannot resume session "<id>": <reason>` line on stderr, `ExitCode.HarnessError`, never a
stack trace. Enumerated:

- **Directory missing:** names the exact path checked (`./.dh-logs/<id>`) and suggests
  `dh logs`/`ls .dh-logs` to find valid ids.
- **Root log missing or headerless:** `agent-root.jsonl` absent, empty, or first parseable
  line is not a `type:"header"` — reported as "not a valid dh session directory".
- **Header mismatch:** header `sessionId` ≠ requested id (renamed/copied directory) — error
  naming both, since silently trusting either invites confusion in the `resumedFrom` chain.
- **Unsupported header version:** anything but `1` — clean "written by a newer dh" error.
- **Tolerated, not fatal:** individual corrupt/truncated lines (skipped, exactly like
  `log-analysis.ts`), a truncated final line, dangling tool_uses (repaired per D1), missing
  sub-agent files (they only feed the lost-work listing). If tolerant parsing yields a header
  but **zero replayable conversation events**, resume proceeds with an empty history and the
  notice says so — equivalent to a fresh start, but honest.
- **Broken resume chain:** a `resumedFrom` link naming a missing/invalid directory fails with
  the id of the missing link (the operator may have pruned it — DH-0037 retention can legally
  delete an ancestor); a cycle or a chain longer than a hard cap (e.g. 100) fails as corrupt.
- **Model alias unresolvable in current config:** per D3.

### D7. Domain assignment

- **Core (Grace)** — owns the feature: `--resume` flag parsing + mode composition + failure
  messaging (`src/cli.ts`); the replay fold `LogLine[] → ProviderMessage[]` including dangling-
  tool_use repair and trailing-role merge (new `src/agent/resume.ts` — it produces
  `ProviderMessage`, an agent-internal type, so it cannot live in Server); `AgentRuntimeOptions.
  resume` / `AgentLoopParams.resume` seeding in `runtime.ts`/`loop.ts`; the resume-notice text.
- **Server (Radia)** — support only: export a reusable raw-log reader from
  `src/server/log-analysis.ts` (generalize the private `parseJsonlFile` into e.g.
  `readAgentLogLines(sessionDir, agentId): LogLine[]` plus a `readSessionHeader` for chain
  walking) — Server owns the on-disk session layout, and DH-0037 already built the tolerant
  parsing; Core imports it via `src/server/index.ts` exactly as `cli.ts` already imports
  `SessionLogger`/`formatSessionLogTree`. **No `SessionLogger` changes** (D4). `loop.ts`
  continues to never import `src/server/` — the boundary crossing happens in `cli.ts`, which
  already does.
- **Contracts** — the additive `resumedFrom` header field (D4); architect-signed by this design.
- **E2E (Hedy)** — follow-up coverage, sequenced after Core lands: kill a mock-provider run
  mid-tool-call, `--resume`, assert the reconstructed request body the mock receives contains
  the pre-crash turns + the synthesized interrupted tool_result + the notice, and that the new
  directory's header carries `resumedFrom`.

## Notes

> [!NOTE]
> Source: dark-factory ops audit findings #9 and #16; independently raised as a capability gap by
> the competitive-differentiation sweep (finding #6, "no session persistence/resume across process
> restart"). Related to but distinct from **DH-0003** (`SendMessage` resuming a *finished-but-
> still-in-process* agent) — this ticket is about surviving a full process restart, not an
> in-process finished-task resume.

> [!NOTE]
> Owner decision (2026-07-15): queue both stories now — the confusing-message fix and the full
> `--resume` mechanism. Full resume (reconstructing conversation state from JSONL after a
> process restart) is substantial and needs an architect design pass before implementation,
> per CLAUDE.md §6.1/§6.3; the message fix is small enough to implement directly without one.
> Routed to Fable for the resume design.
