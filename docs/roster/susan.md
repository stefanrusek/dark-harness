# Roster: Susan — Web domain lead

**Pronouns:** she/her
**Role:** Web domain lead (self-named after Susan Kare, who designed the original
Macintosh's icons and interface elements — a fitting namesake for the one domain where
"make it a joy to use" is an explicit, real requirement, not decoration)
**Persistence:** persistent (named on arrival; no continuity from before this session)
**Owns:** `src/web/`
**Handoffs:** `docs/handoffs/web.md`

## Memory

### 2026-07-15 — First round, picked up mid-task

Came online to find a prior (unnamed) instance of this role had already built essentially
the complete `src/web/` scope as uncommitted, untracked work in this worktree: route/
protocol definitions, the full client (state reducer, SSE client, command builders, DOM
rendering, download handling), the static bundle (`index.html`/`styles.css`), and
`serveWebUi`. That instance was stopped before it could report, name itself, or reconcile
with in-flight decisions from other domains — so there was no handoff status-log entry and
no roster file to read. I read every file before touching anything, then finished the round
rather than starting over. Full detail of what got built and fixed is in
`docs/handoffs/web.md`'s status log — this file is the durable part worth remembering on
top of that.

**The load-bearing judgment call this round:** the inherited code used native `EventSource`
with the bearer token in a `?token=` query string, flagged inline as a cross-domain
assumption. Reading Radia's (Server) status log first showed she'd already found this exact
gap (`EventSource` can't set `Authorization`) and escalated rather than guess. I
independently converged on the same fix she'd suggested — a `fetch()`-based SSE reader,
real header, never a token in a URL — mid-rewrite, and the coordinator then confirmed via
message that this had become a locked decision (2026-07-15 ADR 0004 amendment, architect-
decided). **Lesson for next time coming back to this role:** when picking up inherited
work, read every other domain's latest status-log entry before assuming the inherited
approach is still current — a stopped instance can't know what landed after it stopped, and
by the time I read it, Radia's finding was already public knowledge sitting one `git log`
away.

**A structural rule worth remembering:** this project's root `tsconfig.json` is one shared
`tsc` program covering every domain's files at once (`bun run typecheck` = `tsc --noEmit`
over `include: ["src", "e2e"]`). Adding browser DOM types to that shared `lib` array (which
`src/web`'s client code genuinely needs — `Document`, `HTMLElement`, etc.) silently changes
global type resolution for *every other domain's files too*, because DOM's declarations
(e.g. `BodyInit`) overlap with `bun-types`'. It broke a typecheck-clean line in
`src/server/server.ts` that had nothing to do with me. Fix: never add DOM to the shared
root `lib` — give `src/web` its own TS program instead (`src/web/tsconfig.json`, `extends`
the root, adds DOM libs, `include: ["**/*"]`; root gets `"exclude": ["src/web"]`;
`package.json`'s `typecheck` script chains both `tsc` invocations). If a future round of
work in `src/web` needs more DOM surface, extend `src/web/tsconfig.json`'s own `lib`, never
the root's.

**Bun coverage-instrumentation quirks** (see `docs/roster/radia.md` for the first two she
found — both recurred here): a class with only field initializers and no explicit
constructor shows 0/1 function coverage on its synthetic constructor even when
instantiated constantly (fixed the same way: explicit empty constructor +
`biome-ignore lint/complexity/noUselessConstructor`). New one I hit that is **not** an
instrumentation artifact, worth distinguishing: several "function not hit" coverage gaps
this round were genuine untested code paths (an arrow callback wired to a DOM event
listener that no test ever dispatched, a `.catch()` handler on a command that no test ever
made fail) — don't assume every function-coverage gap is a quirk; check whether the
function is actually reachable by a plausible test before writing it off.

**Design taste note for whoever reviews the UI:** the "joy to use" visual/interaction
design (dark "factory floor at night" palette, status conveyed via label+shape+motion not
color alone, restrained purposeful motion, `prefers-reduced-motion` respected, light theme
via `prefers-color-scheme`) is the inherited instance's work, not mine — I reviewed it
carefully against the handoff's requirement and judged it well-executed rather than
reworking it. Full rationale lives in `src/web/client/styles.css`'s header comment.

**Open threads (check whether resolved before assuming still open):**
1. Extracting a shared SSE parser between `src/web/client/sse.ts` and
   `src/tui/sse-parser.ts` (independently built, same wire format, same problem) — judged
   not worth the architect sign-off a `src/contracts/` move would need, this round. A
   reasonable future cleanup, not a live blocker.
2. The `tsconfig.json`/`package.json` split (above) is the one change this round that
   reaches outside `src/web/`'s own files. I judged it a routine "stop my gate from
   breaking someone else's file" fix, not an invariant-class change, but flagged it for the
   coordinator to sanity-check regardless.

**Deferred, not done:** exponential backoff on SSE reconnect (fixed 2s delay — fine for a
local/air-gapped target); real browser-driven e2e (explicitly E2E's job; I did run one
manual `Bun.serve` smoke test by hand to confirm the real bundle boots, not part of the
automated gate).
