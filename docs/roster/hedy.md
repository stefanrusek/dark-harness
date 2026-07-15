# Roster: Hedy — E2E domain lead

**Pronouns:** she/her
**Role:** E2E domain lead (`e2e/`) — real-binary end-to-end tests: PTY harness for the TUI,
headless browser for the web UI, HTTP/SSE across real processes, mock provider endpoint.
**Persistence:** persistent
**Owns:** `e2e/`
**Handoffs:** `docs/handoffs/e2e.md`

## Memory

### 2026-07-15 — Round 1: stood up the suite, found two real integration bugs

Picked "Hedy" (Hedy Lamarr) coming online — first time this domain has an owner (it was
blocked until Core's round 2 landed real Server/TUI/Web wiring).

**Worktree note:** the worktree I was launched into (`agent-afc969d4c7e712eba`) was
branched from an early ancestor commit (`12679e4`, before any of the five domains landed) —
not from `origin/claude/coordinator-onboarding-kab9ls` HEAD like the task briefing assumed.
Confirmed via `git merge-base --is-ancestor` that it had zero unique commits of its own, so I
fast-forwarded it to the real HEAD (`34e49a1`) before starting. Worth the coordinator
double-checking worktree provisioning if this recurs — a worktree silently missing five
domains' worth of code would otherwise look like "everything is stubbed" instead of "wrong
base commit."

**What I built:** see `docs/handoffs/e2e.md`'s 2026-07-15 status log entry for the full
rundown — mock Anthropic-compatible provider, a build-once-per-run helper, a tmux-based PTY
harness (documented why tmux over `node-pty`: no confirmed native-build toolchain, tmux
already present and verified), Playwright against the pre-installed Chromium with an
explicit `executablePath` (pinned `playwright-core` revision 1228 vs. the pre-installed
1194 — version mismatch, not a bug), and five test files (exit codes, server protocol,
security matrix, TUI, web) — 18 tests, all green, plus `typecheck`/`lint` clean.

**Judgment calls:**

- Chose to keep the mock provider minimal — only `POST /v1/messages`, since that's the only
  endpoint `AnthropicProvider.complete()` ever calls. No streaming support needed (the
  adapter never sets `stream: true`).
- When e2e testing surfaced two real cross-domain bugs (the TUI/Web root-agent bootstrap
  deadlock, and the missing CORS `Access-Control-Expose-Headers` for log-download
  filenames), I did **not** fix them myself (out of `e2e/`'s ownership, CLAUDE.md §3) and did
  **not** quietly design tests to avoid exercising the broken paths. Instead: confirmed each
  precisely (manual `curl` reproduction for the deadlock; comparing Node-`fetch` vs.
  real-browser-`fetch` behavior for the CORS issue), wrote tests that assert the *actual*
  current behavior with an inline explanation of why, and wrote up both prominently in the
  handoff status log as cross-domain requests. This is exactly the kind of thing ADR 0008
  says real-binary/real-browser e2e is for ("miss real integration failures unit tests
  wouldn't catch") — I think surfacing them loudly is more valuable than a quieter partial
  workaround, but flagging here in case the coordinator wants to route this differently
  (e.g. as a blocking issue vs. a routine next-round fix).
- Did not attempt to test a *second* message to an already-completed root agent (multi-turn
  conversation) — traced it far enough to notice `AgentRuntime.sendMessageToRoot` becomes a
  silent no-op post-completion (the `pendingMessages` queue it feeds is never drained again),
  which reads as a separate, narrower Core-domain question rather than something to route
  around in e2e's own coverage. Flagged, not resolved.

**Open threads for whoever picks this up next round:**

- Once TUI/Web fix the bootstrap deadlock, `e2e/tui.test.ts`'s local-mode test and
  `e2e/web.test.ts` can very likely drop their "kick off turn 1 via direct API call" workaround
  and drive the entire flow through real keystrokes/clicks — worth revisiting then, the
  comments in both files point at exactly what to change.
- Sub-agent (`Agent` tool) e2e coverage is a clean next slice: script a `tool_use` mock turn
  and assert the sidebar/tree shows a child node — the support modules here (mock provider's
  `toolCalls` field already exists) are ready for it, just not exercised yet.
- Haven't touched `.github/workflows/`; someone should confirm `bun run e2e` is actually
  wired into the gate (Nightingale's domain).

### 2026-07-15 — Round 2 (fresh process, no memory of Round 1): fixed the Round-5-superseded tests

Came online fresh (no memory of the Round 1 instance's session) to act on Core's Round 5
cross-domain request: three tests in `e2e/server-protocol.test.ts` still assumed "one message
ends the session" (a real design Core deliberately superseded that round — interactive
sessions now pause `"waiting"` between exchanges instead of ending), so they hung/failed.

Read this file and `docs/handoffs/e2e.md` first per CLAUDE.md §7's resuming convention, then
Core's Round 5 diagnosis (already precise — exact tests, exact line ranges, exact fix,
pointing at `src/cli.test.ts`'s own Round-5 fix as the pattern to mirror). Fixed all three:
swapped `session_ended` waits for `agent_status: "waiting"` waits in the resume and
download-logs tests (their actual point — SSE resume semantics, log/tar shape — never
depended on the session ending); for the full-turn test, added an explicit `stop_agent` POST
before the `session_ended` wait, and changed the expected `exitCode` from `0` to
`ExitCode.TaskFailure` (Round 3's "stop collapses into failed" convention, not a success
completion).

**Judgment call:** kept the fix minimal and mechanical, exactly as Round 5's request framed
it — no new coverage added (e.g. no new test for a genuine second exchange producing new
output; that's arguably still open work, see below) since the task was specifically "these
three tests are stale, fix them," not "expand multi-turn coverage." Full detail in
`docs/handoffs/e2e.md`'s Round 2 status log entry.

**Open thread still not picked up:** a real e2e test proving a *second* `send_message` to an
already-waiting root agent produces new output that references the first exchange (the
`runtime.test.ts`/`cli.test.ts` accumulating-echo pattern Core used in Round 5, at the
real-binary/real-HTTP+SSE level) — flagged by the Round 1 instance, still not built. Would
slot naturally alongside the now-fixed full-turn test in `server-protocol.test.ts`.

**Gates:** `bun run typecheck` clean, `bun run lint` clean on the touched file (pre-existing
untracked `dh.json` lint failure is unrelated, noted in the handoff), `bun test
e2e/server-protocol.test.ts` — 5 pass, 0 fail. Did not run the full `bun run e2e` (no
tmux/Chromium in this sandbox, unrelated to this change, per the task's own scoping).
