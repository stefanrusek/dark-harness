---
spile: ticket
id: DH-0050
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0001, DH-0037]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0050: No structured final-result convention beyond the `TASK_FAILED` text marker, and no machine-readable progress stream for `--job`

## Summary

The only self-report convention is the `TASK_FAILED` substring scan — success/failure is binary
and purely textual, with no structured payload (files changed, summary, artifacts) that downstream
orchestration could parse deterministically instead of scanning free text. Separately, the
standalone `--instructions --job` path's only stdout output is a single free-text dump of the final
message plus an exit code — there's no incremental, machine-readable (e.g. NDJSON) progress stream
suitable for piping into another automated tool's stdout consumer in real time, the way some
comparable CLIs' `--json` modes work.

## User Stories

### As an orchestrator consuming `dh --job` output, I want a structured final result, not just free text to scan

- Given a completed job, when it finishes, then an optional structured result block (or a
  companion file, see DH-0037's `summary.json`) is available alongside the plain-text final
  message.

### As an orchestrator, I want an option for incremental machine-readable progress on stdout

- Given `--job` with a `--json`-style flag, when the run progresses, then NDJSON events are
  emitted to stdout incrementally, not just a single dump at the end.

## Design (2026-07-15 — architect pass, Fable)

Architect decision per CLAUDE.md §6 triggers #1 and #4 (exit-code contract / ADR 0006).
This section is the signed contract for the `src/contracts/` changes below; implementers
build against it as written. It also resolves DH-0001's open question — that ticket's fix
is the Core slice of this design.

### Decision

Move the self-report from a free-text marker scan to a **structural mechanism**: a new
built-in `ReportOutcome` tool the model is instructed to call as its final action, with the
legacy `TASK_FAILED` text-marker scan retained as a deprecated fallback. Detection precedence
in the agent loop (non-interactive mode only — interactive sessions skip self-report
entirely, unchanged):

1. **`ReportOutcome` tool call with a valid `status`** — authoritative. The turn in which a
   valid call lands is terminal: the loop ends with that outcome after executing the turn's
   tool calls. Last valid call in the turn wins.
2. **Missed-call nudge (the actual reliability fix)** — if a non-tool-use turn ends with no
   valid `ReportOutcome` ever recorded and `stopReason !== "max_tokens"`, the loop injects
   **one** synthetic user message demanding the call and runs one more turn (counts against
   `maxTurns`). This is what makes the mechanism strictly stronger than the marker: the
   absent-signal state becomes *detectable and recoverable* instead of silently scoring as
   success.
3. **Legacy fallback** — if the model still ends without the tool call after the nudge,
   today's behavior applies exactly: `max_tokens` truncation → failure; `TASK_FAILED` in the
   final text → failure; otherwise → success. No model or e2e fixture gets *worse* than today.

### Why a tool call is more reliable than a magic string (argued, not asserted)

- **It rides a trained, first-class channel.** The tool schema is re-presented in every
  provider request in the dedicated `tools` slot the model's serving stack formats specially
  and its post-training targets directly; the marker convention lives in one system-prompt
  paragraph competing with thousands of other prose tokens. Prompt round 5 already maximized
  that prose channel (worked examples, self-check) and the risk remains — wording is tapped out.
- **The capability is already proven in-session.** Any model that can operate dh at all calls
  tools constantly (Bash/Read/Edit are how it does anything) — the mechanism reuses the one
  skill the model has demonstrably exercised all run, instead of a separate
  "remember-a-token-in-free-text" skill exercised zero times before the final turn.
  gemma-4-31b, the confirmed DH-0001 failure case, ran tool calls fine; it only dropped the
  literal marker.
- **The decisive property is detectability, not memory.** A forgotten marker is
  indistinguishable from success — the harness cannot even know to react. A forgotten tool
  call is a distinguishable state (`turn ended, no ReportOutcome recorded`) the loop detects
  and corrects via the nudge. The claim is not "models never forget the tool"; it is that
  forgetting becomes observable and recoverable instead of silently misclassified.
- **Garbled payloads degrade gracefully.** An invalid `status` still arrives as a named
  `tool_use` block; the tool returns an `isError` result telling the model to call again with
  `"success"` or `"failure"`, and the fallback chain still backstops it. A garbled marker
  (e.g. `TASK FAILED`) is just invisible.
- **Honest cost:** a model that never calls the tool lands exactly where we are today, and
  every legacy-behaving run pays one extra (cheap) nudge turn. Accepted.

### Contract: `src/contracts/outcome.ts` (new file — architect-signed here)

```ts
export const REPORT_OUTCOME_TOOL_NAME = "ReportOutcome";

export interface ReportedOutcome {
  status: "success" | "failure";
  summary?: string;        // 1–3 sentence plain-language outcome
  filesChanged?: string[]; // repo-relative paths created/modified/deleted
  artifacts?: string[];    // deliverables beyond changed source (paths/URLs)
}

/** Terminal NDJSON line for `--job --json` (see below). */
export interface JobResultLine {
  version: 1;
  type: "job_result";
  timestamp: string;
  success: boolean;
  exitCode: 0 | 1;
  reportedBy: "tool" | "text-marker" | "clean-end" | "max-tokens" | "max-turns";
  turns: number;
  finalOutput: string;
  outcome?: ReportedOutcome; // present iff reportedBy === "tool"
}
```

Additive change to `src/contracts/log.ts`: the `completed` and `failed` log lines gain an
optional `outcome?: ReportedOutcome` field (ADR 0005 schema is additive-extension-safe;
this design entry is the architect review §6 trigger #2 requires). `failed`'s `reason`
gains the value `"model reported failure via ReportOutcome"`.

### Tool: `src/agent/tools/report-outcome.ts`

- `name: "ReportOutcome"` (`REPORT_OUTCOME_TOOL_NAME` from contracts). Description instructs:
  call exactly once, as the last action of the run, with honest `status`; the description
  itself carries the instruction so it travels in every request, independent of the system
  prompt.
- `inputSchema`: `{ type: "object", properties: { status: { type: "string", enum: ["success", "failure"] }, summary: { type: "string" }, filesChanged: { type: "array", items: { type: "string" } }, artifacts: { type: "array", items: { type: "string" } } }, required: ["status"] }`.
- `execute()`: no side effects — validates `status`; invalid → `isError: true` with a
  corrective message; valid → `"Outcome recorded. End your turn now without further tool
  calls."`. The **loop, not the tool, is the authority**: `loop.ts` intercepts `tool_use`
  blocks by `REPORT_OUTCOME_TOOL_NAME` and parses the payload leniently itself, so
  `ToolContext` needs no new callback and completion logic stays in one place.
- Registration: added to `src/agent/tools/index.ts`, but the runtime includes it in the
  tools map **only for non-interactive runtimes** (the standalone `--instructions`/`--job`
  path and any runtime where the self-report convention is active). Interactive sessions
  never see it — they have no exit-code semantics to report into.

### `src/agent/loop.ts` changes (Core)

- Track `reportedOutcome: ReportedOutcome | null` and `nudged: boolean`.
- Tool-use branch: after `runToolCalls`, scan the turn's `tool_use` blocks for a valid
  `ReportOutcome`; if found, terminate — emit `agent_status` `done`/`failed`, emit
  `completed`/`failed` log line carrying `outcome`, return.
- Non-tool-use branch (non-interactive): `max_tokens` → immediate failure as today (nudging
  a truncating model just truncates again). Otherwise if `!nudged` → inject the nudge
  message, `continue`. If already nudged → today's marker scan verbatim.
- `AgentLoopResult` gains `outcome?: ReportedOutcome` and `reportedBy` (the `JobResultLine`
  enum above), threaded to `cli.ts` and (as available) `TaskSnapshot` for sub-agents.
- Nudge text (exported constant): *"You ended your turn without calling the ReportOutcome
  tool. Call ReportOutcome now with status \"success\" or \"failure\" (plus optional
  summary/filesChanged/artifacts). Do nothing else."*

### NDJSON progress stream — independent, second story

**Confirmed independently shippable**; ships as its own Core task, before or after the tool.
`--json` (valid only with `--job`; usage error otherwise):

- stdout becomes NDJSON: every `ServerSentEvent` the root runtime emits is written as one
  JSON line **as-is** — the versioned event union in `src/contracts/events.ts`
  (`agent_output`, `agent_status`, `agent_spawned`, `token_usage`, `session_ended`) is reused
  verbatim, so orchestrators parse one vocabulary and no new incremental schema exists.
- One final `JobResultLine` (above) closes the stream. Exit codes unchanged. Human
  diagnostics go to stderr. Without the ReportOutcome mechanism landed, `outcome` is simply
  absent and `reportedBy` is `"text-marker"`/`"clean-end"` — which is why the two pieces
  compose in either order.
- Boundary with **DH-0037**: `summary.json` (a *file* in the session log dir with
  cost/duration/agent counts) stays entirely in DH-0037; the only obligation here is that
  overlapping field names (`success`, `turns`, `outcome`) match `JobResultLine`'s.

### ADR 0006 impact

Exit-code **values and meanings are unchanged** — no new codes. The Consequences bullet
("a defined, machine-readable way to self-report") changes mechanism. The coordinator
appends this amendment to `docs/adr/0006-exit-code-contract.md` when the Core round lands:

> **Amendment (2026-07-15, DH-0001/DH-0050):** The machine-readable self-report is now, in
> precedence order: (1) the `ReportOutcome` tool call (structured, authoritative); (2) after
> one harness-injected reminder turn, the legacy `TASK_FAILED` text-marker scan, retained as
> a deprecated fallback; (3) a clean no-tool-call end with no marker still maps to success,
> and a `max_tokens`-truncated final turn still maps to failure. Exit-code values are
> unchanged. The marker fallback may not be removed without a further amendment.

### Domain assignment and sequencing

1. **Contracts** — `src/contracts/outcome.ts` + additive `log.ts` fields. Architect-reviewed
   here (§6 trigger #2 satisfied); Core implements to this spec verbatim.
2. **Core (Grace)** — the tool, non-interactive-only registration, `loop.ts`
   detection/nudge/fallback, `AgentLoopResult.outcome`, and the `--json` NDJSON path in
   `cli.ts`. Two separable tasks (tool mechanism; NDJSON).
3. **Prompt (Iris)** — rewrite `REQUIRED_CONTRACT`: lead with "call `ReportOutcome` as your
   final action, every run"; demote `TASK_FAILED` to a clearly-labeled fallback paragraph
   (still taught — the fallback depends on it). README update.
4. **E2E (Hedy)** — mock-provider fixtures for: tool-call outcome (both statuses),
   nudge-then-tool, nudge-then-marker, nudge-then-plain-success; all three exit-code classes
   re-asserted; `--json` stream parsed line-by-line. Existing `taskFailedTurn` fixtures need
   an extra scripted turn for the nudge.
5. **CI/Release** — nothing; no exit-code value changes.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep findings #12 and #16. Relates to **DH-0001** (the
> current text-marker convention this would eventually supplement/replace) and **DH-0037** (the
> `summary.json` artifact, a related but distinct deliverable — a written file vs. a live stdout
> stream).

## Status log

### 2026-07-15 — Architect design pass (Fable)

Design section above added; this ticket now carries the full structured-outcome mechanism
and the NDJSON stream design, and subsumes DH-0001's open question (that ticket tracks the
bug-fix slice — the loop detection change — and its behavioral verification). Status →
`ready`, `blocked_by` cleared: nothing blocks implementation; Core can pick up both tasks,
Prompt in parallel once contracts land.

### 2026-07-16 — Core implementation (Grace), closed

Implemented the full Core slice per the design above, verbatim:

- **`src/contracts/outcome.ts`** (new): `REPORT_OUTCOME_TOOL_NAME`, `ReportedOutcome`,
  `OutcomeReportedBy`, `JobResultLine` — exactly as architect-signed. Additive `outcome?`
  field added to `LogCompletedEvent`/`LogFailedEvent` in `src/contracts/log.ts`.
- **`src/agent/tools/report-outcome.ts`** (new): the `ReportOutcome` tool plus an exported
  `parseReportedOutcome()` helper shared with `loop.ts` (garbled optional fields degrade
  gracefully — only `status` is load-bearing, per the design's own argument). Excluded from
  `ALL_TOOLS`/`composeTools()` (`src/agent/tools/index.ts`) — `AgentRuntime`'s constructor
  (`src/agent/runtime.ts`) adds it to the toolMap only when `!this.interactive`.
- **`src/agent/loop.ts`**: full three-tier precedence implemented — authoritative tool call
  (last valid call in the turn wins), one missed-call nudge
  (`REPORT_OUTCOME_NUDGE_MESSAGE`, exported), then the legacy TASK_FAILED/max_tokens
  fallback. `AgentLoopResult` gained `outcome?`/`reportedBy?`; threaded through
  `AgentRuntime.runRoot()`'s return shape (now also includes `turns`) into `cli.ts`.
- **`--job --json`** (`src/cli.ts`): validated to require `--job` (usage error otherwise);
  streams every `ServerSentEvent` as one NDJSON line via a new `onEvent` param threaded
  through `CliDeps.createRuntime`, closed by a terminal `job_result` line. Judgment call
  (not resolved by the design): `JobResultLine.exitCode`'s `0 | 1` type only covers the
  model self-report outcome, not the full harness-error exit-code space — an
  operator-interrupted (SIGTERM/SIGINT) or crashed run has no self-report outcome to
  describe, so neither path emits a `job_result` line; the NDJSON stream just ends with no
  terminal line, the same signal any NDJSON consumer already gets from a killed process.

**Judgment call on test fallout**: the missed-call nudge is a genuine, intentional behavior
change — every non-interactive run that used to end cleanly on the first non-tool-use turn
now takes one extra turn (the nudge-ack) before the legacy fallback can terminate it. This
broke ~18 pre-existing `loop.test.ts` unit tests whose scripted providers only had one
turn's worth of responses; fixed by adding one repeated nudge-ack turn to each (documented
inline in the test file) rather than changing the design to avoid the churn — the ticket is
explicit that "every legacy-behaving run pays one extra (cheap) nudge turn. Accepted."

**File-conflict note**: this round ran concurrently with an in-flight DH-0044 (streaming)
round touching the same files (`src/agent/loop.ts`, `src/contracts/events.ts`/`log.ts`,
`src/agent/providers/*`) exactly as flagged going in. `loop.ts` merged cleanly — DH-0044's
streaming/coalescing changes and this ticket's precedence-tier logic touch disjoint regions
of the turn loop. Separately, a concurrent commit (`731fb0e`, DH-0110 Web UI fix) swept
`loop.ts`/`loop.test.ts`/`contracts/log.ts`/`contracts/events.ts` into its own unrelated
commit before this round could commit them itself — content unaffected (verified via `git
diff HEAD` showing zero remaining diff on those files after the sweep), just an unusual
commit boundary; this round's own commit (`6666027`) covers every file it could still add
directly (new files, `runtime.ts`, `cli.ts`, `tools/index.ts`, `contracts/index.ts`, tests).
`runtime.test.ts`'s real-HTTP-mock-server suite (25 tests) and 2 tests in `cli.test.ts` fail
independent of this ticket — traced to DH-0044's provider layer now unconditionally
requesting `stream: true` from the Anthropic SDK while the shared mock server in that test
file still returns non-streaming JSON; confirmed by a trivial single-turn test with zero
ReportOutcome/nudge involvement (`runRoot runs the default model end-to-end...`) failing
the same way. Not touched — out of scope, DH-0044's owning round's responsibility.

**Gates**: `bun run typecheck`/`bun run lint` clean for every file this round touched
(`src/web/server.ts`'s pre-existing errors are DH-0110/Susan's, untouched). `bun test src`:
1919 pass / 27 fail — all 27 failures are the DH-0044-provider-layer issue above (confirmed
zero new failures attributable to this ticket by running the affected suites in isolation).
100% coverage on every new/changed file in this round's own diff
(`src/contracts/outcome.ts`, `src/agent/tools/report-outcome.ts`: 100%/100%; `src/agent/
loop.ts`: 100%/99.80%; `src/cli.ts`: 90.10%/99.61%, the two uncovered lines a pre-existing
thin-delegation gap noted in `docs/roster/grace.md`, not new).

**Live verification** (real Bedrock credentials, `secrets.env`, compiled binary): (1) a
scripted "say hello, then call ReportOutcome" instruction produced `reportedBy: "tool"`,
the structured `outcome` (status/summary) carried through both the `--json` `job_result`
NDJSON line and the JSONL log's `completed` line, exit code 0; (2) an instruction telling
the model to reply with plain text and no tool call triggered the missed-call nudge live —
the model's second turn called `ReportOutcome` after being reminded, `reportedBy: "tool"`,
exit code 0.

Closed via `transition.py DH-0050 closed --resolution done`.
