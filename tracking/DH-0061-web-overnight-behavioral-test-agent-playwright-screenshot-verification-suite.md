---
spile: ticket
id: DH-0061
type: feature
status: implementing
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
