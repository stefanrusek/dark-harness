---
spile: ticket
id: DH-0064
type: bug
status: ready
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

# DH-0064: e2e/web.test.ts and connect-web.test.ts assert a stale .agent-output selector

## Summary

Found while completing DH-0061's Web verification spike suite: e2e/web.test.ts and e2e/connect-web.test.ts assert a .agent-output selector that no longer exists in src/web/client/render.ts, superseded by the .agent-transcript .turn-assistant .turn-text structure once DH-0056's Markdown rendering landed. These tests are currently silently stale behind this sandbox's missing-Chromium environmental gap (they never actually run to completion here), same failure-mode-shape as DH-0062. Fix: update both test files to assert against the current selector structure.

## User Stories

### As a maintainer, I want `bun run e2e` to actually exercise current Web DOM structure, not a pre-DH-0056 selector

- Given `e2e/web.test.ts` and `e2e/connect-web.test.ts`, when they assert on rendered
  assistant output, then they use the current `.agent-transcript .turn-assistant
  .turn-text` structure, not the superseded `.agent-output` selector.

## Notes

> [!NOTE]
> Source: Hedy (E2E), surfaced 2026-07-15/16 while completing DH-0061's Web spike suite.
> Same failure-mode shape as DH-0062 (stale assertions silently hidden behind the
> missing-Chromium sandbox gap) — the new spikes (`e2e/spikes/web/*`) already use the
> current selector, so this only affects the two pre-existing gated `.test.ts` files.
