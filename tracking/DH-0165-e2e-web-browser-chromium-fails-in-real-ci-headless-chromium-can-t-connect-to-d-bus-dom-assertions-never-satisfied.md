---
spile: ticket
id: DH-0165
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0165: E2E (web/browser — Chromium) fails in real CI: headless Chromium can't connect to D-Bus, DOM assertions never satisfied

## Summary

Real CI run 29653924839 (branch claude/coordinator-onboarding-kab9ls) shows the web/browser e2e step failing after Chromium and Playwright are correctly installed (DH-0164 fixed that separate issue). Chromium launches headless but stderr is full of "Failed to connect to the bus: Could not parse server address" (D-Bus) and "NameHasOwner" dbus errors; e2e/web.test.ts times out waiting for locator('.dh-app') to be visible, and e2e/streaming.test.ts shows the same launch pattern. Likely needs either a D-Bus session wrapping the test step (e.g. dbus-run-session / xvfb-run) or a Chromium launch flag change in e2e/spikes/web/support.ts. Not yet root-caused beyond this — filed as a follow-up so DH-0164's own fixed CI-only bugs (Chromium install, tmux/PTY Ink-under-CI rendering) aren't reopened by an unrelated failure.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-18 — full CI-green investigation, real root causes found and fixed

Scope broadened in practice to "get the full CI gate green" — this ticket ended up
absorbing both the originally-filed web/browser Chromium failure and a second, unrelated
failure discovered along the way (`E2E (TUI/PTY — tmux)`'s `/skillname` test). Both are now
fixed; real CI run 29656197822 (branch `claude/coordinator-onboarding-kab9ls`) shows every
gate step green, including both e2e Chromium steps and the TUI/PTY step.

**TUI/PTY `/skillname` test — two real bugs, not the timeout-tightness first suspected:**

1. `e2e/support/workspace.ts`'s `writeConfig`/`writeFile` called `Bun.write(...)` without
   awaiting the returned promise, then returned immediately — every e2e test proceeded to
   launch the real `dh` binary before the write was guaranteed to have landed on disk.
   Invisible on a fast local SSD; a real, if not fully deterministic, loss on CI's slower
   disk — worst for `writeFile`'s one nested-path case in the whole suite
   (`skills/greet/SKILL.md`), which also needed an implicit `mkdir` `Bun.write` never
   guaranteed had finished. Fixed: switched both to synchronous `node:fs` `writeFileSync`,
   with `writeFile` doing an explicit `mkdirSync(recursive: true)` first.
2. The real root cause, found only after adding try/catch diagnostics that print the tmux
   screen + provider call count on failure (screen showed "Unknown command: /greet" — the
   skill was never recognized at all): `AgentRuntime`'s eager `discoverSkills()` on-disk scan
   at construction time was fire-and-forget, and `listSkills()` was a plain synchronous read
   of whatever `skillsCache` currently held. A `list_skills` request that lands before the
   async scan resolves (TUI/Web fire it once at startup, right after the ready banner) sees
   only the builtin `cli-tools` entry — every on-disk skill looks "unknown" to the client's
   local cache, which rejects the command before ever attempting a wire round-trip. Fixed:
   `listSkills()` is now `async` and awaits a new `skillsReady` promise before reading the
   cache, threaded through `AgentLoopHandle`, the `cli.ts` adapter, the fake agent loop test
   double, and `server/commands.ts`'s handler.

**Web/browser Chromium — the D-Bus theory in this ticket's original summary was a red
herring.** The actual failure: `.dh-app` never rendered in *any* real browser, ever.
Root-caused by driving a real compiled `dh --web` binary with a scripted Playwright session
locally (JS chunk loaded fine, 200 OK, zero console/page errors — but no `/dh-config.json`
fetch ever fired). `main.ts`'s bootstrap line was
`import.meta.main && void boot(document, fetch)` — correct for `src/cli.ts`'s real
Bun-compiled-binary entry point, but Bun's browser HTML-import bundler
(`src/web/server.ts`'s `Bun.serve({ routes: { "/": html } })`) has no "main module" concept
for browser-bundled code and statically folds `import.meta.main` to `false`, dead-code-
eliminating the guarded `boot()` call entirely. This was only ever masked by the earlier
Chromium-install failure (DH-0164) that kept these tests from actually running until now —
the D-Bus stderr noise in this ticket's original summary was real but not the actual
blocker. Fixed by splitting the unconditional self-invoke into its own file,
`src/web/client/bootstrap.ts` (now the real `<script src>` `index.html` points at), while
`main.ts` goes back to exporting `boot` only. New `bootstrap.test.ts` exercises the module-
scope self-invoke itself, which is what would have caught this originally.

Also added: standard `--no-sandbox`/`--disable-setuid-sandbox`/`--disable-dev-shm-usage`/
`--disable-gpu` launch args to every e2e `chromium.launch()` call (real CI-container
hygiene, independent of the boot() bug); and — after `e2e/connect-web.test.ts` kept hanging
with zero diagnostic output even at a 90s budget specifically when run third in the same
process tree as `web.test.ts`/`streaming.test.ts`'s own Chromium sessions — split it into
its own `gate.yml` step, the same structural fix DH-0164 already established for the
tmux/PTY step (never let more resource-heavy e2e work share one job step's process tree
than it needs to).

Resolution: done. Every CLAUDE.md §5 gate command green in real CI
(run 29656197822 — https://github.com/stefanrusek/dark-harness/actions/runs/29656197822).
