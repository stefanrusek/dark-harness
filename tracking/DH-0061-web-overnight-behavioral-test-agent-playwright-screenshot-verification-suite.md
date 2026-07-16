---
spile: ticket
id: DH-0061
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0061: Web overnight behavioral test agent: Playwright screenshot verification suite

## Summary

Build a haiku-sub-agent-runnable test plan + prompt set that drives the real compiled Web UI via Playwright (real browser, visual screenshot captures), covering every implemented behavior and every UI-testable ticket. Modeled on the owner's proven overnight-verification technique used successfully with Fable once already (too expensive to repeat per-run) - this session's fleet methodology should drive it instead. Sister ticket to DH TUI test agent (tmux-based).

## User Stories

### As the owner, I want a haiku sub-agent to autonomously drive the real Web UI overnight and verify it behaves the way I would check it myself in the morning

- Given a long-running unattended implementation session, when it finishes, then a haiku
  sub-agent can run a fixed set of prompts against the real compiled binary's served Web UI
  (via Playwright, already a project devDependency per `e2e/connect-web.test.ts` and DH-0046's
  design) and report pass/fail per behavior with visual screenshots as evidence, without a
  human needing to click through each one by hand.

## Test Plan (feature list to verify)

**Core implemented Web behaviors:**
- Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.
- Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and
  updates live as an agent transitions.
- Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).
- Transcript shows both the user's own sent messages and the assistant's responses, clearly
  delineated.
- Token/cost figures display per-agent and as a session total, and accumulate correctly across
  multiple turns (DH-0028's Web side was already correct; verify it still is).
- SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect
  indicator, then resumes without duplicating or losing transcript content (DH-0024).
- Log download works and produces a valid file.
- Multi-turn conversation: sending a second message after the agent pauses (waiting) continues
  the same conversation, not a fresh one.

**Ticket-driven Web behaviors (verify the fix actually shipped, not just unit tests):**
- **DH-0056**: assistant output renders real HTML formatting (headings, bold, italic, inline
  code, fenced code blocks, lists, links) via sanitized DOM — never raw Markdown syntax
  characters, never raw HTML interpreted from model output, links open safely
  (`rel="noopener noreferrer"`, non-http(s)/mailto schemes rejected).
- **DH-0029**: keyboard-only navigation can reach the agent list (Tab-reachable, visible focus
  state); ARIA live regions announce status changes (verify via accessibility tree snapshot,
  not just visual); a "stopped" status has a distinct color from "failed"/"done"; errors
  persist in a visible history rather than disappearing after a few seconds.
- **DH-0023**: CORS/CSP/clickjacking headers are present on responses (verify via network
  inspection, not just visually).
- **DH-0044** (once implemented): a long assistant turn's text visibly streams incrementally
  rather than appearing all at once when the turn completes.
- **DH-0012**: this can't be visually verified in a short session (it's a 50-entry eviction
  threshold) — note as out-of-scope for this suite, covered by unit tests instead.

## Functional Requirements

- Each test prompt must be self-contained: build the real binary fresh (or use an
  already-built one, implementer's call), launch it serving the Web UI against the mock
  provider (reusing `e2e/support/mock-provider.ts` conventions), drive it with Playwright
  (clicks/keystrokes/network assertions), capture a screenshot, and assert on the page state —
  no reliance on internal knowledge only a human tester would have.
- Prompts must be runnable by a haiku-tier sub-agent with no additional context beyond the
  prompt itself and this repo — self-contained, per PLAYBOOK.md's persistent-vs-anonymous
  dispatch guidance (these are anonymous, single-shot verification runs).
- A failing prompt must produce a clear, specific pass/fail signal plus the screenshot as
  evidence (not just "something looked wrong").
- **Owner requirement (2026-07-15): the overnight run produces one comprehensive report, not
  scattered per-scenario output.** The orchestrating agent (whatever runs the full suite
  end-to-end, dispatching each stamped prompt) must collect every scenario's screenshot and
  PASS/FAIL/EXPECTED-FAIL verdict, and assemble a single report enumerating every Test Plan
  item / acceptance criterion by name with its verdict and an embedded/linked screenshot — a
  human reading only that one report in the morning should be able to tell, for every
  acceptance criterion in this ticket's Test Plan, whether it passed, without opening any
  other file or artifact directory by hand. Implementer's call on exact report format (an
  HTML or Markdown file with embedded/linked screenshots is the natural choice), but it must
  include the actual screenshot for every scenario, not just a pass/fail line.

## Notes

> [!NOTE]
> Owner-proposed technique (2026-07-15): previously done manually once with Fable directly
> driving verification — too expensive to repeat per overnight run. This ticket + its sister
> **DH-0060** (TUI) exist so the fleet's existing methodology can produce and re-run this
> verification cheaply (haiku-tier) instead of re-spending an architect pass every time.
> **Routed to the architect (Fable) for a real design pass** — per the owner's explicit
> request, Fable should write actual spike scripts (real, runnable prompt/harness examples)
> and attach them to this ticket so the implementing agent has a proven pattern to extend,
> not just a written plan.

> [!NOTE]
> Architect pass done (2026-07-15, Fable): spikes written, **executed, and green** against
> the real compiled binary + headless Chromium — see `## Spikes` below. Two real findings
> surfaced while running them: (1) after a completed turn in `--web`, the root agent pauses
> at `waiting` (interactive semantics, Core Round 5) — `e2e/web.test.ts` still asserts
> `done` + a "Session ended" banner and has been silently stale behind the missing-Chromium
> sandbox gap (filed separately for Hedy); (2) selecting an agent row re-renders the sidebar
> and **replaces the focused DOM node, dropping keyboard focus to `<body>`** — selection
> state survives, but a keyboard user loses their place (a DH-0029 follow-up for Susan, not
> asserted as a hard failure in the spike).

> [!NOTE]
> **Round 2 done (2026-07-15/16, Hedy — implementer): remaining Test Plan coverage
> complete.** Stamped out the five remaining spikes Fable's architect pass sketched
> (`spike-agent-tree.ts`, `spike-log-download.ts`, `spike-multi-turn.ts`,
> `spike-liveness.ts`, `spike-reconnect.ts`) plus their matching prompts (see `## Round 2
> Prompts` above), each individually executed and green against the real compiled binary +
> headless Chromium. Built `e2e/spikes/web/run-all.ts`, the orchestrator the ticket's
> 2026-07-15 owner-requirement note asked for: runs all nine spikes as subprocesses and
> writes one comprehensive, standalone `REPORT.html` (embedded base64 screenshots, a
> Test-Plan-item coverage table, per-scenario detail) — see `## Orchestrator + comprehensive
> report` above for the full description. Ran it end-to-end myself and inspected the
> resulting report: `RESULT: PASS (9/9 spikes fully passed)`, 12 Test Plan items enumerated
> PASS, 2 correctly marked OUT OF SCOPE (DH-0044 streaming — not yet implemented; DH-0012 —
> explicitly out of scope per the ticket, covered by unit tests). Every Test Plan item in
> this ticket except DH-0044/DH-0012 now has a real, green, runnable spike. Quality gates
> (`typecheck`, `lint`, `test:coverage`) all pass; confirmed `bun run e2e`
> (`bun test e2e`, `*.test.ts` glob) does not pick up any spike or orchestrator file — no
> gate-set change. One stale-selector defect noted for later (not fixed here, out of a
> spike's scope): `e2e/web.test.ts`/`e2e/connect-web.test.ts` assert a `.agent-output`
> selector that no longer exists post-DH-0056 (see the fact recorded above the Orchestrator
> section). Leaving `status: implementing` rather than closing — this may still want a final
> coordinator/architect review pass before DH-0061 is considered fully done.

## Spikes

Real, runnable scripts under `e2e/spikes/web/` — deliberately **not** named `*.test.ts`, so
`bun run e2e` never picks them up (they are overnight-verification scripts, not gate tests),
but they ARE covered by `bun run typecheck` and `bun run lint` (root tsconfig includes
`e2e/`). Each is a standalone process run from the repo root with `bun <path>`; each builds
the real binary (via `e2e/support/build.ts` → `scripts/build.ts`), scripts the mock provider
(`e2e/support/mock-provider.ts`), launches the real `dh --web` (or `--server`), drives it,
and prints machine-readable output: one `[PASS]`/`[FAIL]`/`[EXPECTED-FAIL]` line per check
plus a final `RESULT: PASS|FAIL (...)` line, exiting 0 iff every hard check passed.
Screenshots land in `e2e/spikes/web/artifacts/` (gitignored), absolute path printed on the
`RESULT:` line.

| Script | Test Plan item | Executed 2026-07-15 |
| --- | --- | --- |
| `e2e/spikes/web/spike-transcript.ts` | Core: transcript shows user + assistant turns, delineated; status badge; token/cost per-agent + session total | PASS 9/9 + screenshot |
| `e2e/spikes/web/spike-markdown.ts` | DH-0056: headings/bold/code/fences/lists/safe links as real DOM; no raw `##`/`**`; `<script>` inert; `javascript:` link rejected | PASS 11/11 + screenshot |
| `e2e/spikes/web/spike-accessibility.ts` | DH-0029: listbox/option roles, live regions, **computed aria snapshot** (`locator.ariaSnapshot()`), Tab reachability + visible focus ring, Enter-selects, stopped≠failed color, persistent error log panel | PASS 11/11 + screenshot |
| `e2e/spikes/web/spike-headers.ts` | DH-0023: CORS contract (hard checks, browserless `fetch`) + CSP/X-Frame-Options/nosniff as `[EXPECTED-FAIL]` until DH-0023 ships | PASS 5/5 hard, 3 expected-fail |
| `e2e/spikes/web/spike-agent-tree.ts` | Core: agent tree renders parent/child hierarchy — a real `Agent`-tool `toolCalls` turn spawns a sub-agent (two-provider pattern per `e2e/server-protocol.test.ts`); sidebar grows a second, non-`.root` row; both rows settle at their real terminal status; selecting the child row shows its own header | PASS 7/7 + screenshot |
| `e2e/spikes/web/spike-log-download.ts` | Core: "Download log" (per-agent JSONL, header line carries `agentId`) and "Download session bundle" (tar, non-empty, names the agent log) both produce real, valid files via `page.waitForEvent("download")` | PASS 7/7 + screenshot |
| `e2e/spikes/web/spike-multi-turn.ts` | Core: a second `sendMessage` after the root parks at `waiting` continues the same conversation — transcript accumulates to 4 turns (not reset to 2), both replies stay visible, the mock provider sees exactly 2 separate requests, and the second request's history includes the first user message | PASS 6/6 + screenshot |
| `e2e/spikes/web/spike-liveness.ts` | Core: liveness/heartbeat — a deliberately-slow scripted `/v1/messages` handler (`support.ts`'s mock provider is always instant, so this spike runs its own delayed one) proves `.agent-elapsed`/`.status-elapsed` text keeps advancing mid-turn, not frozen, and the turn still completes afterward | PASS 3/3 + screenshot |
| `e2e/spikes/web/spike-reconnect.ts` | DH-0024: a real `dh --server` process is killed and a fresh one respawned on the same port behind a live `dh --connect --web` client; `.gap-banner` starts hidden, becomes visible with non-blank text once the client reconnects, and no duplicate turns appear | PASS 5/5 + screenshot |

Shared plumbing is `e2e/spikes/web/support.ts`:

- `launchWebUi(turns)` — the whole pattern in one call: mock provider → isolated workspace
  `dh.json` → spawn `dh --web` → parse `web UI ready at <url>` off stdout → headless
  Chromium → wait for `.dh-app` + connection pill `Live`.
- `resolveChromiumExecutable()` — tries `/opt/pw-browsers/chromium` (CI sandbox), then
  playwright's own `chromium.executablePath()`, then scans the local playwright cache for
  **any** installed `chromium-*` revision, newest first. This matters: observed live that
  the pinned playwright wants revision 1228 while the machine has 1223/1232 — the exact
  mismatch e2e/web.test.ts's header comment describes. A revision-adjacent Chromium is fine
  for behavioral checks.
- `createReport(name)` — the `[PASS]`/`[FAIL]`/`[EXPECTED-FAIL]`/`RESULT:` printer + exit
  code. `expectedFail(...)` is for known-unimplemented behavior (currently DH-0023's
  headers): reported, never fails the run, flips to `[PASS]` automatically when the fix
  ships — at which point the implementer should promote those to hard `check(...)` calls.

Facts the implementing agent must build on (all observed by running, not assumed):

1. **Interactive pause, not session end:** after one completed turn in `--web`, the root
   row's `data-status` is `waiting` and the badge reads `Waiting` — no session banner.
   Assert `waiting` (or accept `done|waiting` as spike-transcript does), never wait for
   "Session ended" after a single turn.
2. **Every wait must be on rendered content** (`.turn-assistant` present, pill text `Live`),
   never on timing. The mock provider answers instantly; the UI is SSE-driven.
3. **Assert against real DOM classnames** from `src/web/client/render.ts`: `.dh-app`,
   `.connection-pill`, `.agent-tree`/`.agent-row` (+ `data-status`, `.root`), `.status-dot
   .status-<token>`, `.status-badge`, `.agent-header-stats`, `.session-stats`,
   `.agent-transcript`, `.turn`/`.turn-user`/`.turn-assistant`/`.turn-role`/`.turn-text`,
   `.composer-input`, `.error-log-panel`, `.gap-banner`.
4. **Negative assertions are half the value:** no `<script>` element inside the transcript,
   no anchor with a `javascript:` href, no raw `##`/`**` in rendered text, exactly N turns.
5. In-page callbacks (`waitForFunction`/`evaluate`) are passed **as strings**, not arrow
   functions — the repo's tsconfig has no DOM lib (established convention, see
   `e2e/web.test.ts`).

Remaining Test Plan items are stamped out the same way — one `spike-<scenario>.ts` + one
prompt each, reusing `support.ts`: sub-agent tree (script a `toolCalls` mock turn per
`e2e/server-protocol.test.ts`'s two-provider pattern), SSE reconnect (kill/restart the
`--server` process behind a `--connect --web` client, assert `.gap-banner` then no duplicate
turns), log download (`page.waitForEvent("download")` per `e2e/web.test.ts`), multi-turn
(second `sendMessage` after `waiting`, assert turn count 4 and provider request history),
liveness (assert `.status-elapsed`/`.agent-elapsed` text advances across an injected slow
provider turn), streaming (DH-0044, once implemented).

**Round 2 (2026-07-15/16, implementer): all five of the above are now real, stamped, and
green** — see the five new rows in the Spikes table above
(`spike-agent-tree.ts`/`spike-log-download.ts`/`spike-multi-turn.ts`/`spike-liveness.ts`/
`spike-reconnect.ts`). Two build-on facts worth recording for whoever writes the next spike:

1. **A first-ever root turn never emits an `agent_status: "running"` SSE event.**
   `src/agent/runtime.ts`'s `runRoot()` sets `rootStatus = "running"` internally, but that's
   only reflected in a later `request_agent_tree` poll — nothing pushes it over SSE. Only
   the *end* of a turn emits an `agent_status` event. `spike-liveness.ts` originally tried
   to assert a `data-status === "running"` transition and hung; the fix was to stop
   asserting a status label at all and instead assert the elapsed-time text
   (`.agent-elapsed`/`.status-elapsed`) advances across the delay — that *is* the actual
   Test Plan item ("doesn't look frozen"), and it doesn't depend on a status transition that
   the wire protocol doesn't currently send.
2. **`e2e/web.test.ts` and `e2e/connect-web.test.ts` assert a `.agent-output` selector that
   no longer exists** in `src/web/client/render.ts` — superseded by the
   `.agent-transcript .turn-assistant .turn-text` structure once DH-0056's Markdown
   rendering landed. Not fixed here (those are gated `.test.ts` files, out of a spike's
   scope) but flagged for whichever of Hedy/Susan picks up test-file staleness next; every
   new spike written this round uses the current selector.

## Orchestrator + comprehensive report (owner requirement, round 2)

`e2e/spikes/web/run-all.ts` is the single entry point for an overnight run: it spawns each
of the nine spike scripts above as its own `bun <script>.ts` subprocess (in sequence, not
imported/inlined, so one spike crashing can never take the rest of the run down with it),
captures each one's stdout (for its `[PASS]`/`[FAIL]`/`[EXPECTED-FAIL]` lines and final
`RESULT:` line) and its printed screenshot path, then writes one standalone HTML report —
`e2e/spikes/web/REPORT.html` (gitignored alongside `artifacts/`, regenerated by every run) —
satisfying the 2026-07-15 owner requirement that a human reading only that one file can tell
the verdict of every Test Plan item without opening anything else:

- **A Test Plan coverage table**, one row per acceptance-criterion string lifted verbatim
  from this ticket, each with an aggregated PASS/FAIL verdict (FAIL if any contributing
  script FAILed or crashed) and which script(s) it's evidence from — several items are
  covered by more than one script (e.g. token/cost *display* is `spike-transcript.ts`,
  *accumulation across turns* is `spike-multi-turn.ts`), aggregated by item, not just by
  script. The two explicitly out-of-scope items (DH-0044 streaming, DH-0012 eviction
  threshold) are listed too, tagged `OUT OF SCOPE` with a one-line reason — CLAUDE.md §8's
  "no silent truncation" rule applied to test coverage, not just implementation scope.
- **A per-scenario detail section per script**: every `[PASS]`/`[FAIL]`/`[EXPECTED-FAIL]`
  line verbatim, the script's own `RESULT:` line, and its **screenshot embedded inline as a
  base64 data URI** (not merely linked) — the ticket's explicit requirement was that the
  actual screenshot travels with the report, not just a pass/fail line, so the report reads
  standalone even if `artifacts/` is deleted or the report is copied elsewhere.
  `spike-headers.ts` is browserless by design (network-inspection only) and correctly shows
  no screenshot rather than a broken image.
- Exit code 0 iff every spike's `RESULT:` was `PASS` (matches each spike's own convention);
  the orchestrator's own final stdout line is `RESULT: PASS|FAIL (N/9 spikes fully passed)`.

**Run end-to-end, verified 2026-07-16** (this session, real compiled binary + real headless
Chromium, no mocking of the orchestrator itself): `bun e2e/spikes/web/run-all.ts` completed
in one pass, `RESULT: PASS (9/9 spikes fully passed)`, and
`e2e/spikes/web/REPORT.html` (~430KB, embedded screenshots) was opened and inspected —
12 Test Plan items enumerated as PASS, 2 as OUT OF SCOPE, 0 FAIL, 8 of 9 script sections
carrying an embedded screenshot (the 9th, headers, correctly has none).

## Example Prompt

The dispatch model: the haiku agent **runs a pre-written spike script and reports** — it
never writes Playwright code itself. The script owns driving/asserting/screenshotting; the
prompt owns execution and honest reporting. This is the fully worked prompt for the DH-0056
scenario, ready to paste into an `Agent` spawn as-is (one substitution: the repo root).

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): /ABSOLUTE/PATH/TO/dark-harness

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-markdown.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), starts a scripted mock model
   provider, launches `dh --web`, opens the served page in headless Chromium, sends a
   message whose scripted reply contains Markdown plus hostile payloads, asserts the
   rendered DOM (real <h2>/<strong>/<code>/<pre>/<ul>/<a>; no raw '##'/'**'; a
   javascript: link rendered as plain text; a <script> tag kept inert as text), saves a
   full-page screenshot, prints one [PASS]/[FAIL]/[EXPECTED-FAIL] line per check, and ends
   with a single line starting with `RESULT:`. Exit code 0 means every hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0056, the web
client must render assistant Markdown as real sanitized formatting, never raw Markdown
syntax characters and never live HTML/script from model output.
```

## Prompt Template

Stamp one per Test Plan item. Fixed preamble/report/rules text is identical in every prompt
(that uniformity is what makes results comparable overnight); only the four `{...}` slots
change.

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun {SCRIPT_PATH}
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), then {ONE_PARAGRAPH_SCRIPT
   _DESCRIPTION: what it launches, what it drives, what it asserts, that it saves a
   screenshot}, prints one [PASS]/[FAIL]/[EXPECTED-FAIL] line per check, and ends with a
   single line starting with `RESULT:`. Exit code 0 means every hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.
   {OMIT STEP 3 ENTIRELY FOR BROWSERLESS SCRIPTS, e.g. spike-headers.ts}

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed). {FOR BROWSERLESS SCRIPTS: "SCREENSHOT: not applicable"}
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): {TICKET_REF},
{ONE_SENTENCE_BEHAVIOR_STATEMENT}.
```

**What "self-contained" means in practice** — a fresh haiku agent with zero repo context
succeeds only if the prompt itself carries all of:

1. **An absolute working directory** and exact, copy-pasteable commands — never "build the
   project" (it doesn't know how), always `bun e2e/spikes/web/spike-x.ts` (which builds via
   `ensureBuilt()` automatically, so the prompt never needs a separate build step).
2. **What normal looks like**: first-run build time (~up to a minute), build output being
   benign noise, roughly how long the whole script should take — otherwise a haiku agent
   treats compiler chatter or a 30s wait as a failure and aborts.
3. **A single-line verdict contract** (`RESULT: PASS|FAIL`) plus per-check lines it relays
   verbatim — interpretation happens in the script, never in the agent. Weak models are
   reliable transcribers and unreliable judges; the design puts all judgment in reviewed,
   committed TypeScript.
4. **Where evidence lands** (`e2e/spikes/web/artifacts/*.png`, absolute path printed) and
   that a crash still produces a `*-error.png` — so a FAIL report always carries something
   a human can look at in the morning.
5. **Exactly one permitted remediation** (install Chromium), everything else forbidden:
   no editing files, no retry-until-green, no "fixing" the product. Overnight, an agent
   that patches around a failure destroys the run's entire evidentiary value.
6. **The expected-fail convention explained inline**, so known-unshipped features (DH-0023
   headers today) are reported but never miscounted as new defects — and never used as an
   excuse to ignore real `[FAIL]` lines.
7. **For the accessibility script specifically**: the computed aria snapshot is printed
   inside its check's detail text; the agent just relays it. The prompt never asks the
   agent to interpret an accessibility tree itself — the script asserts on it
   (`snapshot.includes('listbox "Agents"')`), the human reads the relayed snapshot if the
   check goes red.

## Round 2 Prompts (2026-07-15/16)

Five new stamped prompts, one per new spike, following the Prompt Template above exactly.

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-agent-tree.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), then scripts a mock model turn
   that calls the real `Agent` tool to spawn a sub-agent (a second, separate mock provider
   answers for the sub-agent), launches `dh --web`, sends a message that triggers the spawn,
   asserts the sidebar grows from one row to two (the new one not marked `.root`), that both
   rows settle into their real terminal status, and that clicking the child row shows its
   own header instead of "Root agent", saves a full-page screenshot, prints one
   [PASS]/[FAIL]/[EXPECTED-FAIL] line per check, and ends with a single line starting with
   `RESULT:`. Exit code 0 means every hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0061 (core),
the web client's agent tree must render a real parent/child spawn hierarchy as sub-agents
are created, not just a single root row.
```

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-log-download.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), launches `dh --web`, sends a
   message, then clicks "Download log" and "Download session bundle" and waits for each
   real browser download event, asserting the per-agent JSONL's first line is a valid header
   naming `agent-root` and the session tar bundle is non-empty and names the same log file
   near its start, saves a full-page screenshot, prints one [PASS]/[FAIL]/[EXPECTED-FAIL]
   line per check, and ends with a single line starting with `RESULT:`. Exit code 0 means
   every hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0061 (core),
the web client's log-download buttons must produce real, valid per-agent JSONL and
session-bundle tar files, not just trigger a click handler.
```

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-multi-turn.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), launches `dh --web`, sends a
   first message and waits for the root agent to park at "waiting", then sends a second
   message, asserting the transcript accumulates to 4 turns (not reset to 2), both replies
   stay visible together, the mock provider saw exactly 2 separate requests, and the second
   request's history includes the first message — proving conversation continuity, not a
   fresh session — saves a full-page screenshot, prints one [PASS]/[FAIL]/[EXPECTED-FAIL]
   line per check, and ends with a single line starting with `RESULT:`. Exit code 0 means
   every hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0061 (core),
sending a second message after the web client's root agent pauses at "waiting" must
continue the same conversation, not start a fresh one.
```

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-liveness.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), starts its own deliberately-slow
   scripted model endpoint (an 8-second delay before replying — this is intentional, not a
   hang), launches `dh --web`, sends a message, and samples the sidebar row's and header's
   elapsed-time text early and again partway through the delay, asserting the text visibly
   advances (proving the UI isn't frozen) before the slow reply finally arrives, saves a
   full-page screenshot, prints one [PASS]/[FAIL]/[EXPECTED-FAIL] line per check, and ends
   with a single line starting with `RESULT:`. This script deliberately takes about 15
   seconds to run — that is expected, not a failure. Exit code 0 means every hard check
   passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0061 (core),
the web client's liveness/heartbeat indicator must visibly update during a long-running
turn instead of looking frozen.
```

```
You are a verification agent. Your entire job is to run one scripted browser check against
the Dark Harness web UI and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/spike-reconnect.ts
   What it does, so you can interpret it: compiles the real `dh` binary (first run may take
   up to a minute and print build output — that is normal), starts a real `dh --server`
   process and a real `dh --connect --web` client pointed at it, sends a message, then kills
   the server process and respawns a fresh one on the exact same port — simulating a server
   restart underneath a live web client — and asserts a reconnect banner (hidden beforehand)
   becomes visible with non-blank text, and that no duplicate turns appear in the transcript
   afterward, saves a full-page screenshot, prints one [PASS]/[FAIL]/[EXPECTED-FAIL] line
   per check, and ends with a single line starting with `RESULT:`. Exit code 0 means every
   hard check passed.
3. Only if step 2 printed "No Chromium found": run `bunx playwright install chromium` once,
   then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the script's `RESULT:` line, verbatim.
- SCREENSHOT: the absolute .png path from the RESULT line (or the -error.png path if the
  script crashed).
- FAILED CHECKS: every `[FAIL]` line, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line, verbatim, or "none" (these are
  known-unimplemented features being tracked — not defects you found, do not count them
  against the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 3 minutes, missing screenshot),
  or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the script hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or the script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the script already asserts all of it): DH-0061
(core, DH-0024), killing and restarting the server process behind a live `--connect --web`
client must trigger a visible reconnect indicator and resume without duplicating transcript
content.
```

## Orchestrator Prompt (round 2)

The overnight run itself is dispatched with one further prompt that runs `run-all.ts` rather
than a single spike — the haiku agent's job is still purely mechanical (run one command,
relay one result), but the artifact it points to is the comprehensive report rather than a
single screenshot.

```
You are a verification agent. Your entire job is to run the full Dark Harness web
verification suite and report the result honestly. You need no prior knowledge of this
repository, and you must not modify any file in it.

Working directory (run every command from here): {REPO_ROOT}

Steps:
1. Run: bun install
   (fast no-op if already installed)
2. Run: bun e2e/spikes/web/run-all.ts
   What it does, so you can interpret it: runs all nine spike scripts in
   `e2e/spikes/web/` in sequence (each compiles/reuses the real `dh` binary, drives a real
   headless Chromium against a scripted mock model — this takes a few minutes total, that is
   normal, not a hang), then writes one comprehensive report to
   `e2e/spikes/web/REPORT.html` listing every Test Plan item by name with its verdict and its
   actual screenshot embedded in the file. Prints each spike's own [PASS]/[FAIL] lines as it
   goes, then a final line starting with `RESULT:` summarizing how many of the nine spikes
   fully passed. Exit code 0 means every spike's hard checks passed.
3. Only if any spike printed "No Chromium found": run `bunx playwright install chromium`
   once, then repeat step 2. That is the only remediation you are allowed.

Report back in exactly this shape:
- VERDICT: the orchestrator's final `RESULT:` line, verbatim.
- REPORT PATH: the absolute path to `REPORT.html` printed just before the RESULT line.
- FAILED CHECKS: every `[FAIL]` line from any spike's output, verbatim, or "none".
- EXPECTED-FAILURES: every `[EXPECTED-FAIL]` line from any spike's output, verbatim, or
  "none" (known-unimplemented features being tracked — not defects, do not count against
  the verdict).
- ANOMALIES: anything else odd you saw (crashes, hangs over 10 minutes, a missing report
  file), or "none".

Rules: a FAIL verdict is a valid, useful result — report it exactly as printed. Never
re-run the suite hoping for a different outcome, never soften a FAIL into a PASS, never
attempt to fix the product or any script, and never report PASS unless the RESULT line
itself says PASS.

Scenario under test (context only — the scripts already assert all of it): DH-0061's full
Test Plan, run overnight as one comprehensive pass rather than nine separate dispatches.
```
