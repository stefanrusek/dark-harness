---
spile: ticket
id: DH-0147
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0132]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0147: Document --job as headless mode; default to a full markdown transcript stream, add --result-only

## Summary

Owner observation 2026-07-17: `dh --instructions <file> --job` was being mentally modeled as headless mode, but neither the docs nor the actual output experience make that explicit or satisfying. Verified against real source (src/cli.ts) before filing: `--job` genuinely does NOT launch the TUI today -- `runInteractiveMode` is only reached when `options.instructions` is null, and the standalone `--instructions`/`--job` path explicitly bypasses Server/TUI/Web entirely (per an existing code comment). So the headless behavior itself is correct; the gap is purely that documentation never calls this out explicitly as headless mode by name, so a reader has to infer it.

Owner-designed output-mode flag scheme (went through several revisions during discussion 2026-07-17; this is the final shape -- a clean 2x2 matrix of breadth x format that preserves `--json`'s existing meaning exactly). **All of this scoping -- `--json`, `--result-only`, and the new default breadth -- applies only to `--job` mode; it has no effect on any other run mode (interactive, `--web`, `--server`, `--connect`).**

|  | markdown (default format) | `--json` |
| --- | --- | --- |
| **default** (full stream) | full conversation, markdown -- **new default**, replaces today's final-output-only default | full conversation, JSON -- **today's existing `--job --json` behavior, unchanged** |
| **`--result-only`** (NEW flag) | final result only, plain text -- **today's old default**, now opt-in | final result only, as JSON |

- `--job` -- headless mode (no TUI). Unchanged, just needs explicit documentation as such.
- `--json` -- pure format selector (markdown vs. JSON), orthogonal to breadth. Its existing meaning (full NDJSON stream) is exactly preserved as the default-breadth + `--json` cell -- no back-compat break for existing `--job --json` scripts.
- **NEW default breadth**: full conversation stream, rendered as markdown, when no other flag is given. This is the actual feature the owner wants -- a readable transcript by default instead of just the final message.
- `--result-only` -- NEW flag. Opts back into today's old default (final result only, not a stream). Combines with `--json` for final-result-as-JSON.

This is a real behavior change to `--job`'s default output (bare-final-output -> full markdown stream) -- owner explicitly accepted this since `--json`'s own behavior is fully preserved and this is pre-1.0/alpha software.

## User Stories

### As an operator running dh headlessly, I want the docs to call --job "headless mode" explicitly, so I do not have to infer it from behavior

- Given a reader consults the README/CLI reference for `--job`, when they read its description, then it explicitly names this as headless mode (no TUI, no interactive session).

### As an operator watching a long unattended run, I want a readable markdown transcript by default, so I can watch tool calls and turns happen without parsing NDJSON or opting into anything extra

- Given `dh --instructions <file> --job` is run with no other output-mode flag, when the run progresses, then a markdown-formatted rendering of the full conversation (turns, tool calls, sub-agent activity) is written to stdout -- readable directly in a terminal or when piped to a file.
- Given `dh --instructions <file> --job --json` is run (today's existing invocation), when the run progresses, then output is unchanged from today's behavior -- the full NDJSON stream.

### As an existing caller who wants just the final output, I want an explicit --result-only flag, so I can opt back into today's old default

- Given `dh --instructions <file> --job --result-only` is run, when the run completes, then stdout is just `result.finalOutput` (today's current default behavior), nothing else.
- Given `dh --instructions <file> --job --result-only --json` is run, when the run completes, then the final result is printed as a JSON object, not a stream.

### As a user of any other run mode, I want these flags to have no effect, so this change is scoped correctly

- Given `--json` or `--result-only` is passed without `--job`, when `dh` starts, then this is a clean usage error (matching the existing `--json requires --job` validation pattern in src/cli.ts) -- these flags are meaningless outside `--job` mode.

## Functional Requirements

- Add `--result-only` as a new CLI flag, valid only alongside `--job`.
- Change `--job`'s default (no `--result-only`) output from `result.finalOutput` to a full markdown-rendered stream of the conversation.
- `--json` remains a pure format selector -- combine with either breadth (default full-stream, or `--result-only`) rather than being its own breadth mode. `--json`'s validation (requires `--job`) is unchanged.
- **Resolved (owner, 2026-07-19): stream the default markdown transcript live, turn-by-turn**
  as the run progresses, matching `--json`'s existing live-streaming behavior — the whole
  point of the new default is watching a long unattended run in progress, not waiting until
  it finishes.
- README/CLI-reference docs: name `--job` as headless mode explicitly, and document the full 2x2 output-mode matrix (default breadth x format, `--result-only` breadth x format).

## Assumptions

- The underlying event data the markdown stream renders from is the same stream `--json`/`onJsonEvent` already taps in src/cli.ts -- this is a new *rendering* of existing data, not new instrumentation.

## Risks

- This changes `--job`'s default output shape (final-output-only -> full markdown stream) for anyone currently relying on the old default without `--json`. Owner explicitly accepted this (pre-1.0/alpha), but flag it clearly in release notes/CHANGELOG when it ships.

## Open Questions

None remaining — resolved in Functional Requirements (live, turn-by-turn streaming).

## Notes

> [!NOTE]
> **Implemented 2026-07-19.** `src/cli.ts`: added `--result-only` (valid only with `--job`,
> matching `--json`'s existing `requires --job` validation pattern); `--job`'s default
> breadth is now a full live, turn-by-turn markdown transcript via the new
> `JobTranscriptRenderer` class (buffers `agent_output` chunks per agent, flushes at each
> turn boundary — `tool_call`/`agent_status`/`session_ended`/a different agent's output —
> since `CliIo.stdout` always appends its own newline). `--json` stays a pure format
> selector; `finalOutput`/the terminal `job_result` line print per the 2x2 matrix. README.md
> updated with the matrix table and "headless mode" naming.
>
> Tests: `src/cli.test.ts` — `parseArgs` coverage for `--result-only` (defaults test,
> "parses every documented flag together", `--result-only requires --job` usage error);
> `--job --result-only exits 0 and prints the final output...` (old default preserved);
> `DH-0011: SIGTERM stops the root agent...` updated to `--result-only` to keep asserting
> `finalOutput` on interrupt. `JobTranscriptRenderer`'s full event-type switch (
> `agent_spawned`/`agent_output`/`agent_thinking`/`tool_call`/`tool_result`/`agent_status`/
> `model_switched`/`session_ended`/`token_usage`/`resync`) is exercised end-to-end by the
> pre-existing real-provider tests ("the real (default) createRuntime dep writes a real
> per-agent JSONL log for a standalone run" / "...writes summary.json...") which already run
> plain `--job` (new default breadth) against a real mock Anthropic-compatible HTTP endpoint
> — verified via `bun test src/cli.test.ts --coverage --coverage-reporter=lcov` that every
> line of the new class has a nonzero hit count. `e2e/exit-codes.test.ts`'s existing
> `--job` assertions on `proc.stdout()` containing the model's final text (`"All done, no
> issues."`, `"TASK_FAILED"`) continue to pass unmodified against the new default breadth —
> the text still appears in the streamed transcript, no e2e assertion changes were needed.
>
> All 4 gates green locally: typecheck, lint, `bun run test:coverage` (0 fail, pre-existing
> non-100% lines in `src/cli.ts`/`src/tui/app.ts`/`src/web/client/app.ts` unchanged from
> baseline), `bun run e2e` (38/38 pass).
