---
spile: ticket
id: DH-0147
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0132]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0147: Document --job as headless mode, and add --all for a full markdown transcript stream

## Summary

Owner observation 2026-07-17: dh --instructions <file> --job was being mentally modeled as headless mode, but neither the docs nor the actual output experience make that explicit or satisfying. Verified against real source (src/cli.ts) before filing: --job genuinely does NOT launch the TUI today -- runInteractiveMode is only reached when options.instructions is null, and the standalone --instructions/--job path explicitly bypasses Server/TUI/Web entirely (per an existing code comment). So the headless behavior itself is correct; the gap is purely that documentation never calls this out explicitly as headless mode by name, so a reader has to infer it.

Owner-designed output-mode flag scheme (revised twice during discussion, this is the final shape, 2026-07-17):

- `--job` -- headless mode (no TUI). Unchanged, just needs explicit documentation as such.
- `--json` -- NDJSON stream of the full conversation (tool calls, intermediate turns, sub-agent activity). Unchanged, existing behavior.
- `--all` -- NEW. Markdown-formatted stream of the full conversation (the markdown equivalent of --json's full-stream content) -- genuinely readable in a terminal or when piped to a file, unlike raw NDJSON.
- *(no output-mode flag)* -- final result only (today's current default: just `result.finalOutput`). Stays the default, unchanged -- no behavior change for existing scripts/callers that only pass `--job`.

`--all` and `--json` are two alternative full-stream output formats (markdown vs. NDJSON) for the same underlying event stream -- both opt-in, mutually exclusive with each other (same relationship `--json` already has to bare `--job` today), neither changes the no-flags default.

## User Stories

### As an operator running dh headlessly, I want the docs to call --job "headless mode" explicitly, so I do not have to infer it from behavior

- Given a reader consults the README/CLI reference for `--job`, when they read its description, then it explicitly names this as headless mode (no TUI, no interactive session).

### As an operator watching a long unattended run, I want a readable markdown transcript option, so I can watch tool calls and turns happen without parsing NDJSON

- Given `dh --instructions <file> --job --all` is run, when the run progresses, then a markdown-formatted rendering of the full conversation (turns, tool calls, sub-agent activity) is written to stdout -- readable directly in a terminal or when piped to a file.
- Given `--all` and `--json` are both full-stream formats of the same underlying event data, when a user passes both, then this is a clean usage error (mutually exclusive), matching the existing `--json`-requires-`--job` validation pattern already in src/cli.ts.

### As an existing caller of --job with no other flags, I want no behavior change, so scripts relying on today's final-output-only default keep working

- Given `dh --instructions <file> --job` is run with no `--json`/`--all`, when the run completes, then stdout behavior is unchanged from today (just `result.finalOutput`).

## Functional Requirements

- Add `--all` as a new CLI flag, valid only alongside `--job` (same validation shape as `--json`'s existing `--json requires --job` check in src/cli.ts).
- `--all` and `--json` are mutually exclusive; passing both is a usage error.
- Design decision needed by whoever implements: stream `--all`'s markdown live turn-by-turn as the run progresses (matching `--json`'s live-streaming nature, likely most useful for an operator watching a long unattended run), vs. building it from the same event stream at the end. Owner's stated preference during discussion leaned toward live streaming, but this should be confirmed/decided explicitly during implementation, not assumed.
- README/CLI-reference docs: name `--job` as headless mode explicitly, and document the full three-way (well, four-state including the default) output-mode flag scheme: default (final result only), `--json` (NDJSON stream), `--all` (markdown stream).

## Assumptions

- The underlying event data `--all` renders from is the same stream `--json`/`onJsonEvent` already taps in src/cli.ts -- this is a new *rendering* of existing data, not new instrumentation.

## Risks

## Open Questions

- Live-streaming vs. end-of-run rendering for `--all` (see Functional Requirements) -- needs a real decision during implementation.

## Notes
