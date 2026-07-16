---
spile: ticket
id: DH-0062
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0061]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0062: e2e/web.test.ts session-ended assertions stale vs interactive waiting semantics

## Summary

Found while executing DH-0061's spikes against a real Chromium (2026-07-15, Fable): after one completed turn in dh --web, the root agent pauses at status 'waiting' (Core Round 5 interactive semantics) with a Stop button and no session banner. e2e/web.test.ts still waits for data-status 'done', a 'Done' badge, and the 'Session ended — success (exit 0)' banner — so it will hang/fail on any machine that actually has Chromium. It has been silently stale behind the missing-Chromium sandbox gap every round since the semantics changed. Fix mirrors Hedy Round 2's server-protocol fix: wait for agent_status 'waiting' (or drive an explicit stop) instead of session end. Owner: E2E (Hedy).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

**Resolution (2026-07-15, Hedy):** Fixed both `e2e/web.test.ts` and `e2e/connect-web.test.ts`
(same stale-"done" bug found in the latter while auditing the former). Both now wait for
`data-status`/badge `"waiting"` instead of `"done"`; `web.test.ts` additionally asserts no
`.session-banner` exists yet, then drives the real "Stop" button (per
`src/web/client/render.ts`'s `renderAgentHeader`, rendered while `status === "waiting"`) and
waits for the session-ended banner afterward — exercising the full interactive-stop path
through the real UI, not just skipping the assertion. `typecheck`/`lint`/`test:coverage`
clean (1259/1259, no `src/` touched). Full `bun run e2e`: 30 pass / 2 fail, both the
long-standing missing-Chromium-binary sandbox gap (`/opt/pw-browsers/chromium` absent),
confirmed by the launch error text itself — not a new regression. Could not run the fixed
assertions against a real browser in this sandbox; verified by reading `render.ts` closely
against the new assertions instead.
