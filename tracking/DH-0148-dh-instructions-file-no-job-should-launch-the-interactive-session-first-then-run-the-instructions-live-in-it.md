---
spile: ticket
id: DH-0148
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0147]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0148: dh --instructions <file> (no --job) should launch the interactive session first, then run the instructions live in it

## Summary

Owner correction 2026-07-17 (I had the order backwards in conversation): today dh --instructions <file> without --job runs the instructed task once via a separate, invisible AgentRuntime (headless, nothing shown), and only AFTER it completes does it print a notice and start a brand-new interactive TUI/Web session -- explicitly noted in src/cli.ts as a fresh session where prior context is not preserved. The owner wants this reversed: launch the interactive session (TUI or --web) immediately, and have the instructions files content become the first message sent into that live session once the root agent connects -- so the operator watches the instructed task run in real time inside the same session, rather than it happening invisibly first and only getting a disconnected fresh session afterward. This only applies to --instructions without --job (per DH-0147, --job stays the fully headless/exit-on-completion path with its own output-mode flags). runInteractiveMode in src/cli.ts currently has no mechanism to auto-send a first message into a freshly-started session -- its only pre-seeding hook is resumeResult (for --resume, replayed history from a prior session, not a fresh instructions-derived first message). This needs new wiring, likely touching how the TUI/Web client auto-sends its first send_message command once the root agent is confirmed ready (mirroring what a human typing the instructions text as their first message would trigger).

**Owner decisions (2026-07-19):**
- The auto-sent first message should be **indistinguishable from a normally-typed message**
  in the transcript — no special badge/label, simplest rendering, no new UI element.
- **`--instructions` (no `--job`) combined with `--web` is allowed**, not rejected — same
  behavior as the local TUI case: launch `--web`, auto-send the instructions file's content
  as the first message once the client connects.

## User Stories

### As an operator running `dh --instructions <file>` (no `--job`), I want to watch the instructed task run live in the interactive session, not invisibly before a disconnected fresh session starts

- Given `dh --instructions <file>` (TUI, no `--web`/`--job`), when the root agent connects,
  then the instructions file's content is sent as the session's first message automatically,
  and the operator watches the run happen live in the same TUI session — no separate
  invisible headless run, no "starting a fresh session" notice afterward.
- Given `dh --instructions <file> --web`, when the web client connects to the root agent,
  then the same auto-send behavior applies — the instructions become the first message in
  that live web session.

### As an operator, I want the auto-sent message to look exactly like a message I typed myself

- Given the instructions file's content was auto-sent as the first message, when the
  transcript renders it, then it is visually indistinguishable from a normally-typed user
  message — no special badge, label, or styling.

### As a user of `--job` mode, I want this change to have no effect there

- Given `dh --instructions <file> --job` is run, when the process starts, then behavior is
  unchanged from DH-0147's fully-headless path — this ticket only touches the
  `--instructions`-without-`--job` case.

## Functional Requirements

- `runInteractiveMode` (src/cli.ts) needs a new pre-seeding hook distinct from `resumeResult`
  (which replays prior-session history for `--resume`) — a fresh-instructions first-message
  hook instead.
- Applies uniformly to both the local TUI path and the `--web` path: whichever client
  connects first sends `send_message` with the instructions content once the root agent is
  confirmed ready, mirroring what a human typing it as their first message would trigger.
- The old behavior (invisible headless run via a separate `AgentRuntime`, then a fresh
  disconnected interactive session afterward) is removed entirely for this flag combination.

## Assumptions

- The instructions file's content is sent as a single message, same as if a human pasted the
  whole file content into the composer and hit send — no special chunking/streaming needed.

## Risks

- Timing: the auto-send must wait for genuine "root agent ready" confirmation (matching
  existing `resumeResult`-style readiness gating), not fire before the client's SSE
  connection is actually live — verify this against real `--web` connection latency, not
  just the local TUI case where it's likely instant.

## Open Questions

None remaining.

## Notes

> [!NOTE]
> **Related but distinct finding, filed separately as DH-0194:** while answering this
> ticket's open questions, the owner flagged that `--job` mode's system prompt should
> explicitly tell the agent it's running non-interactively (no human to ask clarifying
> questions of, must not wait for input, etc.) and adjust its behavior accordingly. That's
> a Prompt-domain change orthogonal to this ticket's interactive-auto-send scope — see
> DH-0194.

> [!NOTE]
> **Implemented 2026-07-19.** `src/cli.ts`: `main()`'s `--instructions` (no `--job`) branch
> now returns `runInteractiveMode(...)` directly, passing the (resume-notice-prefixed, when
> applicable) instructions text as a new `autoSendMessage` parameter — the old standalone
> `AgentRuntime.runRoot()` call, its "job complete; starting a new interactive session"
> notice, and the fresh-disconnected-session fallthrough are removed entirely for this flag
> combination (still present, unchanged, for `--job`). `runInteractiveMode` sends
> `autoSendMessage ?? (resumeResult ? buildResumeNotice(resumeResult) : undefined)` via the
> existing lazy-start `agentLoop.sendMessage(ROOT_AGENT_ID, ...)` path immediately after the
> server/TUI/Web wiring starts — the exact same call a real operator's first typed message
> takes, so the rendered transcript is indistinguishable from one, satisfying the owner's
> "no special badge/label" decision without any TUI/Web rendering change needed. `--web`
> works unmodified since mode composition was already flag-driven — no explicit "allow"
> logic was needed.
>
> Tests (`src/cli.test.ts`, describe block "main — standalone --instructions path"):
> "without --job, --instructions launches interactive mode immediately and auto-sends..."
> (asserts `createRuntime` is never called and the auto-sent message equals the file
> content, proving the old headless-then-fresh-session path is gone); "...combined with
> --resume auto-sends the resume notice plus the instructions content as one first message"
> (User Story 1, resume case); "...combined with --web is allowed and still auto-sends"
> (User Story 1, `--web` case / the owner's "allowed, not rejected" decision). The
> "indistinguishable from a normally-typed message" story (User Story 2) is proven by
> construction — the auto-send goes through the identical `sendMessage(ROOT_AGENT_ID, ...)`
> call a typed message uses, with no separate rendering path added anywhere in `src/tui/` or
> `src/web/`. The `--job` no-effect story (User Story 3) is covered by the full pre-existing
> `--job` test suite continuing to pass unmodified (this ticket's branch is only reached
> when `!options.job`).
>
> All 4 gates green locally: typecheck, lint, `bun run test:coverage` (0 fail), `bun run
> e2e` (38/38 pass, unmodified — no e2e test exercised the old headless-then-fresh-session
> behavior this ticket removes).
