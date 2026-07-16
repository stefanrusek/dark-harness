---
spile: ticket
id: DH-0099
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0099: dh doctor prints nothing until all models are checked; should show live per-model progress

## Summary

runDoctor in src/cli.ts loops over every configured model, awaits each provider.complete() call silently, and only prints the full report (formatDoctorReport) after the entire loop finishes -- so on a config with several models (the new DH-0096 scaffold has a dozen), the operator stares at a blank terminal for however long all the calls take combined, with zero feedback about which model is currently being checked or how many remain. It should print each model's row immediately when its check starts, then update that same row in place (carriage-return/ANSI line rewrite, TTY-gated) with the PASS/FAIL result and color as soon as it resolves -- matching the operator's explicit ask for real-time, in-place status updates rather than a start-to-finish silent wait.

## User Stories

### As an operator running `dh doctor` against a multi-model config, I want to see progress as it happens

- Given a config with N models, when `dh doctor` starts, then each model's row appears on
  screen the moment its check *begins* (e.g. `haiku-bedrock  (provider "bedrock") ... query
  sent`), not after all N checks finish.
- Given a model's check is in flight, when it resolves (pass or fail), then that same
  terminal line updates in place — the pending text is replaced by the PASS/FAIL result and
  color — rather than a new line being appended below it.
- Given stdout is not a TTY (piped/redirected/CI), then fall back to the current
  print-once-at-the-end behavior (in-place line rewriting via `\r`/ANSI is meaningless
  without a terminal) — same TTY-gating convention already used for doctor's PASS/FAIL
  colorization.

## Functional Requirements

- `runDoctor` in `src/cli.ts`: restructure the loop so each model's row is written
  immediately at the start of its check (a "checking..." / "query sent" state), then
  rewritten in place once `provider.complete()` resolves — likely via `\r` + clear-to-end-
  of-line ANSI sequences, TTY-gated exactly like the existing PASS/FAIL colorization.
- `formatDoctorReport` (or a new sibling formatting function) needs a pending/in-flight
  state representation, not just pass/fail, since a row now has three possible visual states
  over its lifetime (pending → checking → resolved).
- Non-TTY behavior (piped output, CI logs) must remain unchanged: print once, at the end,
  no partial/overwritten lines — those don't make sense outside a real terminal and would
  otherwise corrupt piped/log output with stray `\r` sequences.
- Models should still be checked sequentially (current behavior) unless a concurrent-check
  redesign is separately justified — this ticket is about *visibility* into the existing
  sequential process, not about parallelizing the checks themselves (that's a separate,
  bigger scope decision if ever wanted).
- Verify live in a real terminal (not just unit tests) that the in-place update actually
  looks right — capture the visual behavior (e.g. via `script`/asciinema or a description of
  what appeared) in the closing report, since ANSI cursor/line behavior is exactly the kind
  of thing that can pass a mocked-stdout unit test while looking broken in a real terminal.

## Assumptions

- This is scoped to `dh doctor`/`--check` only; it doesn't touch `--dry-run`'s reporting
  (which has no per-model network calls to show progress for).

## Risks

- Terminal cursor/line-rewrite logic is fiddly and easy to get subtly wrong (wrong-width
  clear-to-end-of-line leaving stray characters, cursor position drifting if a line wraps on
  a narrow terminal) — needs real-terminal verification, not just a passing unit test on
  captured stdout strings.

## Notes

> [!NOTE]
> Filed 2026-07-16 after the operator praised `dh doctor`'s correctness (post-DH-0098) but
> flagged the UX as still not "delightful" — explicitly wants live, in-place, flashy status
> updates rather than a silent wait-then-dump. Framed by the operator as a recurring pattern:
> "this is the kind of thing I keep asking for" — i.e. polish/liveness passes have
> repeatedly under-delivered relative to what was asked for (see DH-0095's TUI-margin gap
> for a prior instance). Coordinator is following up with the operator on the root cause of
> that pattern before dispatching further polish work broadly.
