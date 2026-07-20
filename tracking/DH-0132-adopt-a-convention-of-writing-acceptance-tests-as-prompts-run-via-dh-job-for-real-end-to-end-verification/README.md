# DH-0132 prototype: acceptance tests written as `dh --job` prompts

`dh-job-acceptance-example.web-port-host.ts` is a single, self-contained, real example of the
pattern this ticket exists to demonstrate: instead of (or alongside) a `bun:test` assertion,
one real acceptance criterion is written as a literal prompt run through `dh --job --json`
against a **real compiled `dh` binary**, and the criterion's truth is read off the run's real
exit code + `job_result` JSON line.

Run it directly:

```
bun run tracking/DH-0132-.../dh-job-acceptance-example.web-port-host.ts
```

## What it verifies

The composed acceptance criterion from DH-0168 (`--web-port <N>`) and DH-0182 (`--host
<name>`): `dh --web --web-port <N> --host 127.0.0.1` must actually bind its web UI static
server to exactly `127.0.0.1:<N>`, not a random ephemeral port or a different host. This is a
genuinely end-to-end property — "does the real OS actually bind where we told it to" — that a
mocked unit test structurally cannot observe, and that no existing e2e test in `e2e/` (as of
this writing) covers either.

## How it's structured, and why it's a real test and not theater

1. **The outer job** is a real `dh --instructions <file> --job --json` run, scripted against a
   mock Anthropic-compatible provider (same shape as `e2e/support/mock-provider.ts`) so it's
   deterministic and free to run in CI.
2. **Turn 1** always asks the (mocked) model to run one `Bash` tool call: spawn a *child*
   `dh --web --web-port 47591 --host 127.0.0.1` process, wait for it to report ready, `curl`
   it at exactly that host:port, and exit 0/1 with a `VERIFIED`/`FAILED` marker depending on
   what actually happened. `run_in_background: false` is set explicitly — the Bash tool
   defaults to backgrounding a command (HANDOFF.md §4), which would make the tool call return
   "started successfully" immediately, before the real check ever ran.
3. **Turn 2 is the load-bearing part**: the mock provider is *not* the shared
   `e2e/support/mock-provider.ts` (whose scripted turns are consumed in a fixed order,
   independent of what any tool call actually returned). This script's own tiny mock
   provider inspects the real conversation history it receives on the second `/v1/messages`
   call — specifically the prior turn's `tool_result` content block's `is_error` flag — and
   only emits a `ReportOutcome(status: "success")` turn if the Bash tool's own verification
   script really reported success. A real model would reason about the tool result the same
   way; this reproduces that reasoning deterministically.
4. Because of (3), the outer job's exit code (0 success / 1 self-reported failure) and its
   `--json` `job_result.success` field are **genuine proof** the child process bound where
   asked, not a scripted/hardcoded outcome. Verified both ways while building this: run
   against a checkout with DH-0168/DH-0182 present (this ticket's own branch, and the
   checked-in state) -> real `VERIFIED`/`web UI ready at http://127.0.0.1:47591.` line in the
   child's log, `job_result.success: true`, exit 0. Also run, during development, against an
   older checkout predating those two tickets -> real `dh: unknown flag: --web-port` in the
   child's log, `job_result.success: false`, exit 1. Same script, same prompt, opposite real
   outcome depending only on whether the CLI flags actually work — the point of the pattern.

## Pattern to copy for a future ticket

1. Pick one acceptance criterion that's genuinely end-to-end (spawns a process, hits real
   network/filesystem — not "the mock returned what I told it to").
2. Write a Bash command that performs the real check with an unambiguous
   `VERIFIED`/`FAILED` marker and a matching exit code (0/1).
3. Script a two-turn mock provider: turn 1 unconditionally requests the Bash tool call
   (`run_in_background: false`); turn 2 branches on the real `tool_result`'s `is_error` (or
   its text content) to decide which `ReportOutcome` to emit.
4. Spawn the real compiled binary (`bun scripts/build.ts --outfile dist/dh`, or reuse
   `e2e/support/build.ts`'s `ensureBuilt()`), point a `dh.json` at the mock's `baseURL`, run
   `--instructions <file> --job --json`, and assert on the real exit code / `job_result` line.

Not adopted here as a formal CLAUDE.md §9 test tier — that decision is deliberately deferred
to a follow-up ticket per DH-0132's own scope (see the ticket file's Notes).
