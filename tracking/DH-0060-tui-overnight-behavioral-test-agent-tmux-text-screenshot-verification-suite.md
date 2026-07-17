---
spile: ticket
id: DH-0060
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0060: TUI overnight behavioral test agent: tmux text-screenshot verification suite

## Summary

Build a haiku-sub-agent-runnable test plan + prompt set that drives the real compiled TUI via tmux (real PTY, text-screenshot captures via capture-pane), covering every implemented behavior and every UI-testable ticket. Modeled on the owner's proven overnight-verification technique used successfully with Fable once already (too expensive to repeat per-run) - this session's fleet methodology should drive it instead. Sister ticket to DH web test agent (Playwright-based).

## User Stories

### As the owner, I want a haiku sub-agent to autonomously drive the real compiled TUI overnight and verify it behaves the way I would check it myself in the morning

- Given a long-running unattended implementation session, when it finishes, then a haiku
  sub-agent can run a fixed set of prompts against the real compiled binary (via the existing
  `e2e/support/tmux-pty.ts` PTY harness — real terminal, `tmux capture-pane` for "text
  screenshots") and report pass/fail per behavior, without a human needing to sit at a
  terminal checking each one by hand.

## Test Plan (feature list to verify)

**Core implemented TUI behaviors:**
- Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.
- Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and
  updates live as an agent transitions.
- Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).
- Transcript shows both the user's own sent messages and the assistant's responses, clearly
  delineated (DH-0007-era structured transcript).
- Token/cost figures display per-agent and as a session total, and accumulate correctly across
  multiple turns (DH-0028).
- SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect
  indicator, then resumes without duplicating or losing transcript content (DH-0024).
- Log download/export command works and produces a valid file.
- Multi-turn conversation: sending a second message after the agent pauses (waiting) continues
  the same conversation, not a fresh one.
- `TASK_FAILED`/structured-outcome self-report is reflected in the UI's final status marker.

**Ticket-driven TUI behaviors (verify the fix actually shipped, not just unit tests):**
- **DH-0056**: assistant output renders real Markdown formatting (headings, bold, italic,
  inline code, fenced code blocks, lists, links) via ANSI — never raw Markdown syntax
  characters, never a raw/garbled escape sequence.
- **DH-0025**: wide characters (CJK, emoji, combining marks) wrap/pad correctly without
  corrupting the frame; resizing the terminal rapidly doesn't flicker/corrupt; no visible
  full-redraw flicker on the once-per-second idle tick.
- **DH-0026**: input box supports cursor movement (arrow keys, home/end), and previously-dead
  keys now work.
- **DH-0027**: the agent tree view scrolls to keep the selected/highlighted entry visible as
  you navigate a tree taller than the visible pane.
- **DH-0059**: Ctrl+C in local mode (server+TUI same process) stops the agent and exits
  cleanly with the correct exit code; a second Ctrl+C or the fallback timer force-quits if the
  first doesn't complete promptly.
- **DH-0044** (once implemented): a long assistant turn's text visibly streams incrementally
  rather than appearing all at once when the turn completes.
- **DH-0012**: this can't be visually verified in a short session (it's a 50-entry eviction
  threshold) — note as out-of-scope for this suite, covered by unit tests instead.

## Functional Requirements

- Each test prompt must be self-contained: build the real binary fresh (or use an
  already-built one, implementer's call), launch it under `tmux` via the existing PTY harness
  conventions in `e2e/support/tmux-pty.ts`, drive it with realistic keystrokes/mock-provider
  responses, capture the pane, and assert on the captured text — no reliance on internal
  knowledge only a human tester would have.
- Prompts must be runnable by a haiku-tier sub-agent with no additional context beyond the
  prompt itself and this repo — self-contained, per PLAYBOOK.md's persistent-vs-anonymous
  dispatch guidance (these are anonymous, single-shot verification runs).
- A failing prompt must produce a clear, specific pass/fail signal (not just "something looked
  wrong") — e.g. "expected fenced code block content to render without a leading '```'
  character; captured pane shows: <text>".
- **Owner requirement (2026-07-15): the overnight run produces one comprehensive report, not
  scattered per-scenario output.** The orchestrating agent (whatever runs the full suite
  end-to-end, dispatching each stamped prompt) must collect every scenario's captured pane
  ("text screenshot") and PASS/FAIL verdict, and assemble a single report enumerating every
  Test Plan item / acceptance criterion by name with its verdict and evidence — a human
  reading only that one report in the morning should be able to tell, for every acceptance
  criterion in this ticket's Test Plan, whether it passed, without opening any other file.
  Implementer's call on exact report format (Markdown file is the natural choice, consistent
  with this project's existing reporting conventions), but it must include the captured pane
  text for every scenario, not just a pass/fail line.

## Spikes (architect design pass, 2026-07-15 — Fable; executed and verified, not just written)

Real, runnable spike scripts live in **`e2e/spikes/tui/`**. Every one was executed against
the real compiled binary in this repo (twice each, consecutively — 25/25 checks green both
runs) before being committed. They are deliberately **not** `bun test` files: no `.test.` in
the name means `bun run e2e` never picks them up (zero CI-gate surface), while `tsc` and
biome still cover them. Each is a standalone script a verification sub-agent runs directly
and whose stdout it interprets.

| Script | Test Plan items proven | Checks |
| --- | --- | --- |
| `spike-transcript-multiturn.ts` | Transcript delineates user (`> ` marker) vs. assistant turns; a second message continues the *same* conversation (turn 1 still on screen, provider called exactly twice); DH-0028 token totals accumulate (`40 tok` after 2×(10+10) turns) | 6 |
| `spike-markdown-render.ts` | DH-0056 both halves: Markdown renders as real formatting (no `#`/`**`/```` ``` ```` on screen, SGR bold actually applied per raw capture) AND hostile escapes (clear-screen CSI, OSC 52) never reach the terminal | 14 |
| `spike-input-editing.ts` | DH-0026: Left×7 into typed text + mid-string insert, Home-prepend, End-append; the *sent transcript turn* is the ground-truth assertion | 2 |
| `spike-ctrlc-exit-code.ts` | DH-0059: Ctrl+C on a waiting session → `session ended (exit 0)` frame → real process exit code 0 (echoed into the pane via an `sh -c` wrapper); also proves the cyan "waiting" status glyph (status-color Test Plan item) | 3 |
| `spike-support.ts` | Shared boot (`bootLocalTui`) + check + `reportAndExit` report format — the module the implementing agent extends per scenario | — |
| `interactive-boot.ts` | Agent-*driven* mode: stands up binary+mock provider+tmux, prints the session name and exact `tmux send-keys`/`capture-pane` commands, auto-cleans on session end or TTL. For scenarios that need judgment rather than fixed string asserts. Now also takes `--delay-ms <n>` to delay scripted replies (liveness/heartbeat scenarios) | — |

**Round 2 (implementer pass, 2026-07-15/16 — closes out the remaining Test Plan items):**

| Script | Test Plan items proven | Checks |
| --- | --- | --- |
| `spike-agent-tree-hierarchy.ts` | Agent tree renders a real parent/child spawn hierarchy (a genuine `Agent` tool_use turn, not a hand-built fixture — child entry indented one level deeper than root); also proves the green "done" status glyph (status-color Test Plan item, done half) | 4 |
| `spike-task-failed-status.ts` | `TASK_FAILED` self-report reflected in the UI's final status marker — via a spawned sub-agent (the root can never reach "failed" while interactive, see the script's own header comment for why), red "failed" status glyph in the tree | 2 |
| `spike-tree-scroll.ts` | DH-0027: tree view scrolls to keep the selection visible in a 16-entry tree squeezed into a 15-row pane — selection marker never disappears, root entry scrolls out of view as selection moves deep into the list | 3 |
| `spike-log-download.ts` | Log download/export produces a valid file — per-agent JSONL (`application/x-ndjson`, valid header line) and full-session tar bundle (`application/x-tar`, non-empty). Driven directly over HTTP/SSE against a real `dh --server`, not through a TUI keystroke — **the console TUI has no keybinding for this command today** (only the web client exposes a download affordance); see the script's header comment | 6 |
| `spike-wide-char.ts` | DH-0025 (wide-character half only — see Mode B below for the resize/flicker halves): CJK + emoji + combining-mark reply renders verbatim, frame stays at exactly the pane's row count (no corrupted/ragged frame) through the wide-char turn and a following plain-ASCII turn | 6 |
| `spike-sse-reconnect.ts` | DH-0024: kills a real separately-running `dh --server` mid-session (`--connect` mode only — local mode has no independent server to kill), restarts a fresh one on the same port, confirms the client's connection status leaves "open", the "⚠ Reconnected — history may be incomplete." notice appears, and the pre-kill transcript turn is still visible exactly once (not lost, not duplicated) | 6 |

All six ran twice consecutively against the real compiled binary — 27/27 checks green both runs — before being committed, same discipline as round 1's four spikes. `spike-agent-tree-hierarchy.ts`/`spike-task-failed-status.ts` needed one iteration each to fix an assertion that assumed the tree label showed the provider's model id (`(mock-model)`) rather than the `dh.json` model config name (`(sub)`) — fixed by reading the real captured pane instead of guessing, per this project's "actually run it" discipline.

Two small support-module additions backing these: `MockTurn.delayMs` (`e2e/support/mock-provider.ts`) — delays a scripted turn's HTTP response, used by the liveness/heartbeat Mode B scenario below to create a genuinely slow turn instead of an effectively-instant mock reply; and `TmuxSession.resize()` (`e2e/support/tmux-pty.ts`) — issues a real `tmux resize-window`, delivering an actual `SIGWINCH` to the wrapped process, used by the resize/flicker Mode B scenario.

**Two Test Plan items have no fixed-string-assertable script, by design** (per the ticket's own Mode B guidance) and are instead driven directly by the orchestrator (`run-all.ts`, below) as inline scenarios rather than separate `spike-*.ts` files:

- **Liveness/heartbeat during a long turn**: a genuinely slow mock reply (`delayMs: 6000`) lets the orchestrator poll the tree view's per-agent elapsed counter (`[Ns]`) twice, ~3.5s apart, and confirm it actually advanced. This one *is* fully mechanical (no human judgment needed) and reports a normal PASS/FAIL, not a heuristic.
- **DH-0025 resize/flicker**: two sub-claims in one Test Plan bullet. "Resizing rapidly doesn't corrupt" is mechanical (rapid `resize()` calls, checked for exact row count + title-bar integrity after each) and reports a normal PASS/FAIL. "No visible full-redraw flicker on the once-per-second idle tick" is genuinely a temporal visual judgment call a text capture can't fully settle — the orchestrator still captures repeatedly through an idle tick and checks the stable regions never go blank/garbled, but reports this half as `HEURISTIC-PASS`/`HEURISTIC-FAIL`, explicitly labeled as a mechanical proxy, not a substitute for a human actually looking at it.

Run any spike: `bun e2e/spikes/tui/spike-<name>.ts` from the repo root. Exit code 0 = all
checks passed, 1 = at least one failed. Stdout is a fixed machine-readable format:
`=== SPIKE: <name> ===`, one `[PASS]`/`[FAIL] <label>` line per check, the captured pane
between `--- captured pane evidence ---` markers, and a final `RESULT: PASS|FAIL (n/m
checks)` line. **The `RESULT:` line and the exit code are the only pass signals** — a
sub-agent must never infer PASS from anything else.

### Mechanics the spikes proved (read before stamping out more scenarios)

1. **Exit-code capture under tmux**: run the binary as
   `["sh", "-c", '"<binary>"; echo "SPIKE-EXIT:$?"; sleep 60']` (see
   `spike-support.ts`'s `wrapCommand`). When the TUI leaves its alt-screen, the pane falls
   back to the normal screen where the echoed code is visible to `capture-pane`; the `sleep`
   keeps the pane alive to read it. Without the wrapper the pane dies with the process.
2. **The input-box cursor is an inverse-video space** (`CURSOR_MARKER`,
   `src/tui/render.ts`), so a plain capture has a literal `" "` at the cursor position.
   Asserting on the live input line mid-edit will fail with confusing one-space-off
   mismatches — press `End` first (marker moves harmlessly to end of line), or assert on the
   *echoed transcript turn* after sending, which has no marker.
3. **The root agent has no `Status:` detail view** — pressing Enter on the root entry in the
   tree view returns to the root transcript view (`src/tui/state.ts` `handleTreeKey`). The
   only on-screen "waiting" indicator for the root is the tree glyph's color: cyan
   `\x1b[36m●\x1b[39m` = waiting (STATUS_COLOR). Poll `captureRaw()` for it —
   `TmuxSession.waitFor` polls the *plain* capture only, so raw-capture polling is a hand
   loop (see `spike-ctrlc-exit-code.ts`).
4. **Waiting for "waiting" is load-bearing for DH-0059**: stopping an agent paused in
   `waiting` exits 0; stopping one mid-work exits 1. Do not sleep and hope — probe the glyph.
5. **Timing that matters**: `session ended (exit 0)` lingers ~1s before the TUI quits;
   `waitFor` polls every 150ms, so it is reliably catchable but *only* via `waitFor`, not a
   single post-hoc capture. Reply waits use 15s timeouts (mock turns render in ~1–3s
   locally; the margin absorbs first-run binary builds and slow machines).
6. **Left-arrow is modal**: on an *empty* input it opens the agent tree; with text present it
   moves the cursor (DH-0026). Scenario scripts must be explicit about which they intend.
7. **Token totals**: mock turns default to 10 input + 10 output tokens, so the header total
   after N exchanges is `N×20 tok` — deterministic and assertable (`40 tok` after two).
8. **Builds**: every spike calls `ensureBuilt()` (shells to `scripts/build.ts`, same stamped
   build as CI). Fresh per process — a spike run costs one binary build (~seconds). Fine for
   overnight; don't "optimize" this away into a stale-binary bug.
9. **Clean up BEFORE reporting** — found the hard way: `reportAndExit` calls `process.exit`,
   which skips `finally` blocks, so calling it inside the try leaked a live tmux session +
   still-running dh process + temp workspace *per run*. The committed pattern (all four
   spikes): capture evidence and build the checks array inside `try`, `stop()` in `finally`,
   `reportAndExit(...)` after. An overnight suite that gets this wrong accumulates dozens of
   orphaned processes. Verify with `tmux ls` after a run — it should show nothing.

## Example Prompt (fully worked — DH-0056 Markdown rendering)

The exact text a haiku-tier sub-agent receives, with zero other context. This is the
**script-backed** mode: the spike script does the deterministic driving and asserting; the
sub-agent executes it, independently sanity-checks the evidence, and reports. (For
judgment-style scenarios with no script, see mode B in the template below.)

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: Markdown rendering (ticket DH-0056) — assistant output in the dh TUI must render
real Markdown formatting via ANSI, never raw Markdown syntax characters, and hostile escape
sequences in model output must never reach the terminal.

SETUP (all commands from the repo root, /path/to/dark-harness):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either command is
   missing, STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-markdown-render.ts`
   This builds the real compiled binary, launches it under a real tmux pseudo-terminal
   against a scripted mock model, sends keystrokes, captures the terminal pane as text, and
   checks it. It takes up to ~60 seconds. Capture its full stdout and its exit code.

INTERPRET (mechanical rules — do not deviate):
4. The output ends with a line `RESULT: PASS (n/n checks)` or `RESULT: FAIL (...)`.
   - Exit code 0 AND a `RESULT: PASS` line => the scenario PASSED.
   - Anything else — a RESULT: FAIL line, a nonzero exit, a crash, a timeout error showing
     "Last screen:" — => the scenario FAILED. A missing RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence yourself: between the `--- captured pane evidence ---` markers
   is the actual terminal screen. Confirm with your own eyes that it contains the text
   "Heading One" and "code line here", and does NOT contain the literal characters "**" or
   "```". If your reading disagrees with the RESULT line, report FAIL and say so.

REPORT (your final message, exactly this shape):
- First line: `PASS: markdown-render (DH-0056)` or `FAIL: markdown-render (DH-0056)` or
  `BLOCKED: <reason>`.
- Then every `[PASS]`/`[FAIL]` check line from the script output, verbatim.
- Then the full captured pane evidence block, verbatim — always include it, pass or fail.
- If it failed: one sentence stating which expected text was missing or which forbidden
  text appeared, quoting the exact string. Do not speculate about causes. Do not retry more
  than once. Do not attempt fixes.
```

## Prompt Template (stamp one per Test Plan item)

Replace the ALL-CAPS placeholders. Keep every mechanical rule verbatim — the interpretation
and report rules are what make haiku-tier runs reliable; the scenario block is the only part
that varies.

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: SCENARIO_NAME (ticket TICKET_ID) — ONE_SENTENCE_STATEMENT_OF_THE_BEHAVIOR.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/SPIKE_SCRIPT_FILENAME`
   (builds the real binary, drives it under a real tmux PTY against a scripted mock model,
   captures the pane, checks it; allow ~60s). Capture full stdout and the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED.
   A missing RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence block yourself: it must contain EXPECTED_STRINGS and must not
   contain FORBIDDEN_STRINGS. If your reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: SCENARIO_SLUG` / `FAIL: SCENARIO_SLUG` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation,
  at most one retry, no fixes.
```

**Mode B — agent-driven (no per-scenario script yet, or the check needs judgment, e.g.
"doesn't look frozen", "no visible flicker"):** replace the RUN/INTERPRET steps with:

```text
RUN:
3. Start the rig in the background and note the tmux session name it prints after
   SPIKE-TUI-READY (as `session=<name>`):
     bun e2e/spikes/tui/interactive-boot.ts --text "MOCK_REPLY_TEXT" --ttl 300 &
   Wait for the SPIKE-TUI-READY line (poll its output; allow ~60s for the first build).
4. Drive the TUI with tmux (the ready block prints these exact command shapes):
     tmux send-keys -t <session> -l 'literal text to type'
     tmux send-keys -t <session> Enter        # keys: Enter, Left, Right, Home, End, C-c, Escape
     tmux capture-pane -t <session> -p        # plain-text screenshot — your evidence
     tmux capture-pane -t <session> -e -p     # ANSI-preserving screenshot (styling checks)
   DRIVE_STEPS_FOR_THIS_SCENARIO (numbered send-keys/capture steps with the expected screen
   content after each — poll capture-pane up to ~15s for a step's expected text before
   declaring it missing; the screen updates asynchronously).
5. When done: tmux kill-session -t <session>  (the boot script then cleans up after itself).

INTERPRET:
6. The scenario PASSES only if every captured screen matched its step's expectation:
   EXPECTED_STRINGS present, FORBIDDEN_STRINGS absent. Judgment items (JUDGMENT_CRITERIA)
   must be justified by pointing at concrete captured text, not impressions.
```

### What "self-contained" must mean in every stamped prompt

A fresh haiku agent with no repo familiarity succeeds only if the prompt itself carries:

- **The absolute repo path** and the rule that all commands run from the repo root.
- **Exact commands** for every step — prerequisite checks (`bun --version`, `tmux -V`),
  dependency install (`bun install`), and the one run command. Never "build the project" —
  the spike scripts already embed the real build (`scripts/build.ts` via `ensureBuilt`);
  the prompt must not ask the agent to compose a build itself.
- **A closed-world interpretation rule**: the `RESULT:` line + exit code decide PASS/FAIL;
  missing signal = FAIL; BLOCKED is reserved for missing prerequisites. Haiku-tier agents
  will otherwise "helpfully" infer success from partial output.
- **The expected/forbidden strings inline** (not "see the ticket") so the agent can
  cross-check evidence without reading anything else. Forbidden strings matter as much as
  expected ones — raw `**bold**`, a literal ` ``` `, an `ESC[`-prefixed sequence in a plain
  capture, `SPIKE-EXIT:1`.
- **ANSI guidance for captures**: plain `capture-pane -p` output is already escape-free —
  literal `**`/`#`/board characters there are real screen content, not styling; styling
  claims need the `-e` variant. Timestamps/counters (`[3s]`, token counts) vary — prompts
  must never pin them exactly, only substrings that are stable.
- **An explicit output contract** (first-line PASS/FAIL/BLOCKED + verbatim evidence) so the
  overnight orchestrator can aggregate results mechanically.
- **Hard behavioral fences**: do not modify files, at most one retry, no fixes, no cause
  speculation — a verification run that "fixes" something has silently become an
  implementation run.

## Stamped Prompts (Round 2 — the six new scripted spikes)

Every prompt below follows the Prompt Template above verbatim, mechanical rules unchanged;
only the SCENARIO/RUN/expected-forbidden-strings slots vary.

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: Agent tree parent/child hierarchy — spawning a sub-agent via the real Agent tool
must render it indented under its parent in the tree view, and the sub-agent's own status
color (green "done" on success) must update correctly.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-agent-tree-hierarchy.ts` (builds the real binary, drives
   it under a real tmux PTY, allow ~60s). Capture full stdout and the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence block yourself: it must contain `agent-root` and a second entry
   ending in `(sub)` indented deeper than the root line. It must NOT show only one entry. If
   your reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: agent-tree-hierarchy` / `FAIL: agent-tree-hierarchy` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: TASK_FAILED status marker — a sub-agent that self-reports the TASK_FAILED marker
must show a terminal "failed" status in the tree view.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-task-failed-status.ts` (allow ~60s). Capture full
   stdout and the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence: the raw-ANSI evidence block must contain a line with `(sub)`
   preceded by a red-colored dot glyph (the escape sequence `\x1b[31m` immediately before it).
   If your reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: task-failed-status` / `FAIL: task-failed-status` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: Tree-scroll-follows-selection (ticket DH-0027) — navigating a tree taller than the
visible pane must keep the selected entry on screen, not scroll it off or leave the viewport
pinned to the top.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-tree-scroll.ts` (allow ~60s). Capture full stdout and
   the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence: the final captured pane must contain a line starting with
   `> ` (the selection marker) and must NOT contain the literal text `agent-root` (proving the
   viewport scrolled past the root entry as selection moved deep into the list). If your
   reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: tree-scroll` / `FAIL: tree-scroll` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: Log download/export — the download_logs server command must return a valid
per-agent JSONL file and a valid full-session tar bundle. (Not TUI-keystroke-driven: the
console client has no keybinding for this today — see the script's header comment.)

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3). (No tmux dependency for this one — it
   drives a real `dh --server` process directly over HTTP.) If missing, STOP and report
   exactly: `BLOCKED: bun not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-log-download.ts` (allow ~30s). Capture full stdout and
   the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence: it must show `-> 200` for both the per-agent and bundle
   requests, `content-type=application/x-ndjson` for the first and
   `content-type=application/x-tar` for the second, and `byteLength=` greater than 0. If your
   reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: log-download` / `FAIL: log-download` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: Wide-character rendering (ticket DH-0025, wide-character half) — CJK text, emoji,
and combining marks must render verbatim without corrupting the frame, and a plain-ASCII turn
right after must still render correctly.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-wide-char.ts` (allow ~60s). Capture full stdout and the
   exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence: the pane must contain the literal text `宽字符测试`, `🎉`, and
   `café` (note: real captures may show a trailing combining accent as an extra visual mark
   over the final character — this is expected, not corruption), and later
   `Plain ASCII follow-up received.`. If your reading disagrees with the RESULT line, report
   FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: wide-char` / `FAIL: wide-char` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

```text
You are a TUI verification agent. You have no other context; everything you need is below.
Do not modify any file. Your only job is to run one scenario and report the result.

SCENARIO: SSE reconnect (ticket DH-0024) — killing and restarting the server mid-session must
show a visible reconnect notice in the connected client, without losing or duplicating
already-rendered transcript content.

SETUP (all commands from the repo root, ABSOLUTE_REPO_PATH):
1. Check prerequisites: `bun --version` (need >= 1.3) and `tmux -V`. If either is missing,
   STOP and report exactly: `BLOCKED: <tool> not installed`.
2. If `node_modules/` is missing, run `bun install`.

RUN:
3. Execute: `bun e2e/spikes/tui/spike-sse-reconnect.ts` (allow ~60s — it spawns two separate
   real server processes in sequence). Capture full stdout and the exit code.

INTERPRET (mechanical rules — do not deviate):
4. Exit code 0 AND a final `RESULT: PASS` line => PASSED. Anything else => FAILED. A missing
   RESULT line is a FAIL, never a PASS.
5. Sanity-check the evidence: the final pane must contain the literal text
   `⚠ Reconnected — history may be incomplete.` and exactly one occurrence of
   `Hello before the restart.`. If your reading disagrees with the RESULT line, report FAIL.

REPORT (your final message, exactly this shape):
- First line: `PASS: sse-reconnect` / `FAIL: sse-reconnect` / `BLOCKED: <reason>`.
- Every [PASS]/[FAIL] check line, verbatim; then the full evidence block, verbatim.
- On failure: one sentence quoting the exact missing/forbidden string. No speculation, at
  most one retry, no fixes.
```

## Orchestrator (Round 2 — owner requirement: one comprehensive report)

`e2e/spikes/tui/run-all.ts` is the orchestrating agent this ticket's Functional Requirements
call for. `bun e2e/spikes/tui/run-all.ts [--out <path>]`:

1. Runs every scripted spike above as a real subprocess, parses its `RESULT:`
   line/exit code, and records a PASS/FAIL verdict + the full captured evidence for every
   Test Plan item that spike proves (one spike can prove more than one item — each is listed
   separately, per its own header comment).
2. Drives the two Mode B scenarios itself (liveness/heartbeat, DH-0025 resize/flicker) as
   inline TypeScript, using the same `e2e/support/` primitives every spike uses — no
   sub-agent dispatch needed since these are still mechanically driveable steps, just without
   a fixed pass/fail string contract for the flicker half (see the Spikes section above for
   exactly which half is heuristic and why).
3. Writes one Markdown report (default `e2e/spikes/tui/REPORT.md`, override with `--out`)
   with a summary table (every Test Plan item + verdict) followed by one `<details>` section
   per item containing the real captured pane text ("text screenshot") that produced the
   verdict — collapsible so the file is skimmable but nothing is hidden.
4. Exits 0 if every item is `PASS`/`HEURISTIC-PASS`/`OUT-OF-SCOPE`, 1 if anything is a real
   `FAIL` (heuristic verdicts and out-of-scope items never fail the build — they're reported,
   not gated).

Verdict vocabulary the report uses: `PASS`/`FAIL` (fully mechanical, no ambiguity),
`HEURISTIC-PASS`/`HEURISTIC-FAIL` (a best-effort mechanical proxy for a genuinely
judgment-based item — explicitly labeled, a human should still eyeball the embedded evidence
rather than trust the label alone), `OUT-OF-SCOPE` (the ticket itself excludes the item —
DH-0044 not yet implemented, DH-0012 not visually verifiable in a short session).

**Verified end-to-end** (2026-07-15/16, this round): ran twice consecutively against the real
compiled binary. Both runs: 19/19 Test Plan items enumerated, 17 real PASS, 1 HEURISTIC-PASS,
2 OUT-OF-SCOPE, 0 FAIL, exit code 0, no orphaned tmux sessions afterward (`tmux ls` reports no
server running), report written both times (~1,100 lines, includes every captured pane).

## Notes

> [!NOTE]
> Owner-proposed technique (2026-07-15): previously done manually once with Fable directly
> driving verification — too expensive to repeat per overnight run. This ticket + its sister
> **DH-0061** (Web) exist so the fleet's existing methodology can produce and re-run this
> verification cheaply (haiku-tier) instead of re-spending an architect pass every time.
> **Routed to the architect (Fable) for a real design pass** — per the owner's explicit
> request, Fable should write actual spike scripts (real, runnable prompt/harness examples)
> and attach them to this ticket so the implementing agent has a proven pattern to extend,
> not just a written plan.

> [!NOTE]
> **Round 2 (implementer pass, 2026-07-15/16 — Hedy, E2E domain lead) completed the
> remaining Test Plan coverage.** Every item in the Test Plan is now enumerated with a real,
> executed verdict except the two the ticket itself marks out-of-scope (DH-0044 not yet
> implemented, DH-0012 not visually verifiable in a short session) — see the Spikes section's
> Round 2 table and the Orchestrator section above for exactly what proves what. Six new
> spike scripts, six new stamped prompts, one new orchestrator (`run-all.ts`) that runs
> everything end-to-end and produces `e2e/spikes/tui/REPORT.md` — a single, standalone,
> human-readable report enumerating every acceptance criterion by name with its verdict and
> captured pane evidence, per the owner's Functional Requirements note. Ran the full
> orchestrator twice consecutively against the real compiled binary before writing this note
> (19/19 items enumerated, 17 PASS / 1 HEURISTIC-PASS / 2 OUT-OF-SCOPE / 0 FAIL both times, no
> orphaned tmux sessions afterward). Status kept at `implementing` (not closed) — this may
> still want a final coordinator/owner review of the report format and the two heuristic vs.
> mechanical judgment calls (liveness/heartbeat vs. resize-flicker) before being marked done.
>
> Two small, well-justified additions to `e2e/support/` backing this round:
> `MockTurn.delayMs` (mock-provider.ts) and `TmuxSession.resize()` (tmux-pty.ts) — both
> documented in place, both exercised by the new spikes/orchestrator, no other file touched
> outside `e2e/`.
