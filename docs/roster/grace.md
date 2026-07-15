# Roster: Grace — Core domain lead

**Pronouns:** she/her
**Role:** Core domain lead
**Persistence:** persistent
**Owns:** `src/agent/`, `src/config/`, `src/cli.ts`
**Handoffs:** `docs/handoffs/core.md`

## Memory

### 2026-07-15 — first round (resumed from a stopped instance's WIP)

I came online in an existing worktree (`worktree-agent-a572554c3ba0257bf`) with substantial
uncommitted work already on disk from a previous, stopped instance of this role: all of
`src/config/` (dh.json load/validate/interpolate), all of `src/agent/` except `runtime.ts`
and its providers/tools subtrees (Bash/Read/Edit/Write/Agent/ToolSearch/Skill/TaskOutput/
SendMessage/Monitor/TaskStop/McpAuth, the anthropic+bedrock provider adapters, the task
registry, the agent loop with its `TASK_FAILED` self-report convention), plus `bun.lock`/
`package.json` diffs adding `@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime`. I did
not have that instance's own memory of *why* it made each call — only the code and its
inline comments — so I read everything before touching anything, per METHODOLOGY.md's
"status supersedes" principle applied to inherited work-in-progress.

**What I inherited and fixed:**
- Two `exactOptionalPropertyTypes` typecheck errors in `src/agent/runtime.ts` (the
  composition root wiring config → providers → tools → loop → task registry) — the
  `AgentLoopParams.onEvent`/`onLogLine` are optional-but-not-`| undefined`, so passing
  `this.onEvent` directly (which *can* be `undefined`) violated strict optional-property
  typing. Fixed by conditionally spreading the key in only when defined
  (`...(this.onEvent ? { onEvent: this.onEvent } : {})`), same pattern in two call sites.
- `runtime.ts` had **zero tests** — it didn't even appear in the coverage report (bun's
  coverage tool only instruments files a test actually imports; an untested file is
  invisible to it rather than reported at 0%, which I confirmed by watching it appear only
  after I added `runtime.test.ts`). I wrote a full integration suite (16 tests) against a
  real local mock Anthropic-compatible HTTP server (`Bun.serve` returning canned Messages-
  API JSON, keyed off the last message's content so it's order-independent under concurrent
  sub-agents) — this exercises the *real* `AnthropicProvider` end-to-end rather than a fake
  `ModelProvider`, since `createProvider()` always builds a real adapter from config (that's
  literally how the "local provider" pattern in the sample `dh.json` is supposed to work).
  Now 100%/100% funcs/lines.

**What I built new:**
- `src/cli.ts` — the entry point didn't exist at all. Flags: `--web`, `--server`,
  `--connect <host>`, `--port <n>`, `--instructions <file>`, `--job`, `--config <path>`,
  mode-composed exactly per HANDOFF.md §2 / ADR 0001 (`composeMode()` is a pure function of
  parsed flags, independently unit-tested). `--instructions` reads a file (never inline
  text) and runs the root agent directly via `AgentRuntime` (Server/TUI/Web don't exist in
  this worktree yet, so there's nowhere else for that to live this round). `--job` maps the
  result onto `ExitCode` (0/1/2+) exactly per ADR 0006; verified live with three real
  subprocess runs against real local mock servers (success → 0, self-reported `TASK_FAILED`
  → 1, bad `--config` path → 2), not just unit tests. Every other run-mode combination
  currently calls one of five clearly-`TODO`-marked stub functions
  (`startHeadlessServerStub`/`startConsoleStub`/`startWebStub`/`startConnectStub`) instead of
  importing `src/server|tui|web` (which don't exist yet) — swapping stubs for real imports
  once those domains land should be a small, contained change since `main()`'s dependencies
  are already injected via a `CliDeps` interface built exactly for this kind of seam.
- Everything is dependency-injected (`loadConfig`/`readInstructions`/`loadSystemPrompt`/
  `createRuntime`/`io` all live on an overridable `CliDeps`), so tests exercise real
  filesystem/process defaults in some cases and fully-faked versions in others without
  needing `process.exit` to ever actually fire mid-test-suite (the one place it legitimately
  can — `defaultDeps().io.exit`/console.log/console.error — is covered by monkeypatching
  `process.exit` and `spyOn`-ing `console.*` for exactly one test each, then restoring).

**Cross-domain reconciliation (found by reading Server's landed work on
`claude/coordinator-onboarding-kab9ls`, read-only, never merged in):**
- Radia's `src/server/exit.ts` (`waitForExitCode`) subscribes to a `session_ended`
  `ServerSentEvent` to resolve `--job`'s exit code, but my (inherited) `loop.ts` never
  emitted one — a real integration gap, not a hypothetical. Fixed it at the right layer:
  `AgentRuntime.runRoot()` (not `loop.ts`, since "session ended" is a root/session-level
  concept — sub-agents spawned via `spawnAgent()` correctly do *not* emit it) now emits
  `session_ended` with `exitCode` mapped from the root agent's self-report on every normal
  return path, success or failure. Covered by two new tests. Documented inline in
  `runtime.ts` and flagged in `docs/handoffs/core.md`'s status log.
- Radia's `src/server/agent-loop.ts` defines an `AgentLoopHandle` interface she needs Core's
  real loop to satisfy (directly, or via a thin `cli.ts` adapter) once Server lands in this
  tree — and her handoff explicitly asks for this to be routed to Core as a reconciliation
  item rather than assumed to line up. I did **not** guess at building that adapter, because
  `src/server/` doesn't exist in this worktree and there's no way to build/typecheck against
  a shape I can't import — flagged explicitly for the coordinator instead of silently
  deferring it.

**Known, explained coverage gaps (not silent — per CLAUDE.md's "no silent truncation"
rule):**
- `src/agent/tasks.ts`: bun reports 94.74% func coverage (18/19) despite 100% line coverage.
  I instrumented every named/anonymous function in the file with a temporary `console.error`
  marker and confirmed **all 17 real functions fire** across the full suite — the 19th/18th
  entry bun's `FNF`/`FNH` counts isn't traceable to any actual code path (almost certainly a
  synthetic slot for the class's implicit field-initializer constructor). Not a real gap;
  the instrumentation script and its output are in this status-log entry's sibling section
  in `docs/handoffs/core.md` if anyone wants to re-verify.
- `src/cli.ts`: 99.44% lines (178/179), 100% funcs. The one uncovered line is the literal
  `await main(process.argv.slice(2));` inside `if (import.meta.main) { ... }` — I confirmed
  empirically that `import.meta.main` is only `true` for the actual process entry module and
  can't be forced true for an imported module from a test (tried it in an isolated repro).
  This is the same class of gap as Python's `if __name__ == "__main__":` — a genuine process-
  entry boundary, not something a unit test can reach without literally spawning `dh` as a
  subprocess (which is the E2E domain's job, not this round's gate). I verified it manually
  instead: ran `bun run src/cli.ts` three times against real local mock servers and confirmed
  exit codes 0/1/2 as documented above.

**Deferred / explicitly out of scope this round:**
- `McpAuth` — inherited as a documented stub (OAuth flow) per the handoff's own allowance;
  I didn't touch it.
- `src/agent/mcp.ts`'s `ToolSearch` backing — inherited scope note says it searches
  *configured* `mcpServers` entries and returns synthetic descriptors; it does not dial a
  real MCP server. I didn't change this.
- No actual `--connect` client, headless server, or TUI/web rendering — those are stubs by
  design this round (Server/TUI/Web haven't landed in this worktree). See the cross-domain
  section above for what Core still needs to reconcile once they do.

All three gates green: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (233
tests, 99.85%/99.98% funcs/lines aggregate, both shortfalls explained above).
