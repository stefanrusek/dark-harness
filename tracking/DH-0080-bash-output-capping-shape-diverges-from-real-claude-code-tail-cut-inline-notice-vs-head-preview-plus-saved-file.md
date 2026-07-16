---
spile: ticket
id: DH-0080
type: bug
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

# DH-0080: Bash output-capping shape diverges from real Claude Code: tail-cut inline notice vs head-preview-plus-saved-file

## Summary

Empirical live-run test (2026-07-16, this session, real Claude Code Bash tool invoked directly with 'python3 -c print(X*50000)', a ~48.8KB single-line output): real Claude Code's own harness responded with 'Output too large (48.8KB). Full output saved to: <path>\nPreview (first 2KB): <first 2KB of output>...' -- i.e. it (a) triggers well below dh's 30,000-char cap (~48.8KB > 30k chars, so dh would already be truncating too, but the threshold and shape differ), (b) shows a HEAD preview (first 2KB), not a tail, (c) persists the full output to a real file on disk and reports that path back in the tool result, rather than inlining a truncated tail. dh's bash.ts (via output-cap.ts, capOutput()) instead caps at 30,000 chars, keeps the TAIL (most recent output), and reports '[output truncated: showing last 30000 of N total chars]' inline with no on-disk save and no path -- a materially different truncation shape (head-preview+file vs tail+inline), not just a different threshold number.

## User Stories

### As an agent that ran a command with large output, I want to recover the full output the same way real Claude Code lets me, rather than permanently losing everything before the tail

- Given a Bash command whose output exceeds the cap, when the tool returns a truncated
  result, then the full output is still recoverable afterward (e.g. via a saved path),
  not permanently lost outside the capped window — matching real Claude Code's
  save-to-file-plus-preview behavior.
- Given a truncated result, when the agent reads the notice, then it's clear whether it's
  seeing the head or the tail of the output, and how to get the rest.

## Functional Requirements

- `src/agent/tools/output-cap.ts` / `bash.ts`: consider changing the truncation shape from
  "inline tail + notice, original discarded" to "inline head preview + full output persisted
  somewhere retrievable" to match the observed real-Claude-Code shape — or, if tail-keeping
  is judged intentionally better for dh's use case (e.g. command failures often put the
  useful error at the *end* of output, which a head-preview would cut off), explicitly
  document that as a deliberate divergence rather than an accidental one, since right now
  it reads as accidental (no comment in output-cap.ts addresses this).
  Note dh's `TaskOutput` tool may already partially solve the "get the rest" problem for
  background tasks (full output retrievable there); this ticket is about the *foreground*
  Bash-call truncation shape specifically, and whether a similar retrieval path is needed
  there too.
- Reconcile the exact threshold: this session's real-Claude-Code test tripped the cap at
  ~48.8KB output; dh's cap is 30,000 characters (~30KB) — in the same order of magnitude
  but not confirmed identical; needs a tighter live bisection before treating either number
  as authoritative.

## Assumptions

- The "Output too large... saved to... Preview (first N):" behavior observed live in this
  session is the actual behavior of invoking a Bash-equivalent tool call as this agent
  experiences it — but it was not independently confirmed whether this mechanism lives in
  Bash's own tool implementation specifically versus a more general tool-result-size
  handling layer in the surrounding harness/SDK that would apply to any oversized tool
  result, not just Bash. Flagged explicitly as a scope caveat: if it turns out to be a
  harness-wide mechanism rather than Bash-specific, the comparison is still valid (dh's
  agent loop has no equivalent general oversized-tool-result handling either, as far as
  this session confirmed), but the "right" place to fix it in dh might be broader than just
  `bash.ts`/`output-cap.ts` (e.g. a shared result-capping layer for all tools, not just Bash
  and TaskOutput).

## Risks

- Persisting full tool output to disk (to support a "saved to <path>" recovery flow) is a
  new filesystem side-effect dh's tools don't currently have for this purpose — needs a
  clear location/cleanup policy (temp dir? session-scoped? never cleaned up?) if pursued.
- Changing tail-keeping to head-keeping could regress real dh workflows/tests that
  currently rely on seeing a long command's final lines (often where the actual error is)
  — this is a real behavioral trade-off, not just a cosmetic capping-format change; needs a
  design decision, not a mechanical fix.

## Open Questions

- Is this genuinely a Bash-tool-specific behavior in real Claude Code, or a general
  oversized-tool-result mechanism in the surrounding harness? Affects where in dh the fix
  belongs.
- Exact byte/char threshold real Claude Code uses — not tightly bisected this round (only
  one data point, ~48.8KB, triggered it).

## Notes

> [!NOTE]
> Found 2026-07-16 during the owner-directed systematic empirical tool-conformance testing
> pass (methodology per DH-0070's live-run precedent). Live-run evidence, both sides: dh's
> exact behavior confirmed by reading `src/agent/tools/output-cap.ts` and `bash.ts` in this
> session; real Claude Code's behavior confirmed by this session's own direct Bash tool call
> (`python3 -c "print('X'*50000)"`, ~48.8KB output) producing a head-preview + saved-file
> response rather than an inline tail. Genuinely new finding — none of DH-0069 through
> DH-0078 covers Bash's output-capping shape. Filed `draft` rather than `ready` given the
> real open design trade-off (head vs tail keeping) and the unresolved scope-boundary
> question (Bash-specific vs harness-wide) noted above — this needs a design call, not just
> mechanical parity.

### 2026-07-16 — Implemented (Grace, Core domain)

Added `capOutputWithSavedFile()` in `src/agent/tools/output-cap.ts`, used by `bash.ts`'s
foreground (non-`run_in_background`) return path only.

- **Shape**: on overflow (same `OUTPUT_CAP_CHARS = 30_000` trigger as before — left as-is,
  not re-bisected against real Claude Code's single ~48.8KB data point per the ticket's own
  caveat that the two aren't confirmed identical), the full output is written to
  `os.tmpdir()/dh-bash-output/<uuid>.txt`, and the returned notice shows a head preview (first
  `HEAD_PREVIEW_CHARS = 2000` chars — matches real Claude Code's observed behavior exactly)
  **plus** a tail preview (last `TAIL_PREVIEW_CHARS = 2000` chars) and the saved path.
- **Head vs tail decision**: implemented real Claude Code's head-only behavior as the
  baseline, then added the tail preview on top as a deliberate, explicitly-commented dh
  addition (not silent drift) — command failures often put the actually-useful error at the
  end, exactly the risk this ticket flagged about going head-only. The full output is always
  recoverable from the saved file regardless of which preview a given failure needs.
- **Scope decision (Bash-specific vs shared layer)**: kept this Bash-specific. Did not touch
  `capOutput()` (the original tail-only, no-save function), which remains in use by
  `task-output.ts` — TaskOutput already has its own "get the rest" mechanism (incremental
  delta by default, `full: true` to re-fetch everything), so it doesn't have Bash's specific
  problem (a one-shot foreground return with output permanently gone past the cap). Documented
  this reasoning directly in `output-cap.ts`'s header comment, including a note to revisit if
  a third foreground-and-uncapped tool shows up later.
- **Cleanup policy**: `ToolContext` carries no session/log directory (checked `types.ts`), so
  there's no session-end hook to key cleanup off of. Used a fixed-file-count cap instead
  (`MAX_SAVED_FILES = 50`, oldest-by-mtime eviction run after every save) in a stable temp
  subdirectory — bounds disk usage without needing session lifecycle plumbing.
- Updated the Bash tool's `description` to describe the new save+preview behavior instead of
  the old tail-only claim.
- Gates: typecheck/lint clean. `bun run test:coverage`: 1331 pass, 0 fail, 100% coverage on
  the new `output-cap.ts` code (boundary-exact case, save+prune-on-overflow case, head/tail
  content assertions, a saved-file-count-cap test). `bash.ts`'s 91.67% function-coverage
  figure is the same pre-existing inline-arrow-function bun-coverage quirk prior Grace rounds
  have footnoted, not a new gap — line coverage is 99.23%, unaffected by this change's own
  code paths. `bun run e2e`: 30 pass / 2 fail — both pre-existing headless-Chromium-missing
  sandbox failures, confirmed identical via `git stash -u` + re-run with this round's changes
  stashed out.
