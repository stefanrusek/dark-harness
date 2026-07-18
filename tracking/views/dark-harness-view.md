---
spile: view
project: Dark Harness
source: tracking/
---

<!-- GENERATED — do not hand-edit. Regenerate whenever a ticket's front matter changes.
     Built from tracking/DH-*.md. -->

# Dark Harness — tracker view

## Needs Attention

| ID | Title | Blocked by |
| --- | --- | --- |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance | deferred (owner decision 2026-07-15): no incident behind this, revisit near real release cut |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows | deferred (owner decision 2026-07-16): cutting for now, real feature wanted later — GitHub issue #8 created to gauge demand |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback | deferred (owner decision 2026-07-15): sweep-sourced idea, not a real requested need |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability | deferred (2026-07-15): sweep-sourced, no observed fleet-ops need |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents | deferred (2026-07-15): reactive retry sufficient so far |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs | deferred (2026-07-15): sweep-sourced, no observed need |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI | deferred, revisit soon (2026-07-15) |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute | deferred (2026-07-15): no observed sustained-outage incident, same as DH-0049 |
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions | deferred (2026-07-16): GitHub issue #7 created to gauge demand |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | status: verifying |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | status: verifying |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | status: verifying |
| [DH-0121](../DH-0121-dh-needs-a-logo-svg-ascii-art-versions.md) | dh needs a logo: SVG + ASCII art versions | status: verifying |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | status: verifying |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | status: verifying |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | status: verifying |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | status: verifying |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | status: verifying |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | status: verifying |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | status: verifying |
| [DH-0135](../DH-0135-ui-overhaul-phase-2-migrate-web-client-to-react.md) | UI overhaul phase 2: migrate Web client to React | blocked on DH-0133a (Core toolchain) landing first |
| [DH-0136](../DH-0136-ui-overhaul-phase-2-migrate-tui-to-ink.md) | UI overhaul phase 2: migrate TUI to Ink | blocked on DH-0133a (Core toolchain) landing first |
| [DH-0140](../DH-0140-agent-message-queue.md) | Agents need an incoming-event message queue: mid-turn events (e.g. background sub-agent completions) are currently orphaned, not queued | status: verifying |
| [DH-0141](../DH-0141-formalize-a-periodic-refactoring-round-mechanism.md) | Formalize a periodic refactoring-round mechanism | status: verifying |
| [DH-0145](../DH-0145-src-tui-app-test-ts-fails-in-ci-yoga-layout-top-level-await-wasm-init-races-ink-s-synchronous-mount-not-a-dh-0126-ordering-bug.md) | src/tui/app.test.ts fails in CI: yoga-layout top-level-await WASM init races Ink's synchronous mount, not a DH-0126 ordering bug | status: verifying |

## Board

### draft

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance 🔒 | feature | stefan |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows 🔒 | feature | stefan |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback 🔒 | feature | stefan |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability 🔒 | feature | stefan |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents 🔒 | feature | stefan |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs 🔒 | feature | stefan |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI 🔒 | bug | stefan |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute 🔒 | feature | stefan |
| [DH-0057](../DH-0057-mcp-oauth-support-via-mcpauth-tool.md) | MCP OAuth support via McpAuth tool | feature | stefan |
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions 🔒 | feature | stefan |
| [DH-0132](../DH-0132-adopt-a-convention-of-writing-acceptance-tests-as-prompts-run-via-dh-job-for-real-end-to-end-verification.md) | Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification | feature | stefan |
| [DH-0142](../DH-0142-tui-commands-should-autocomplete.md) | TUI: / commands should autocomplete | feature | stefan |
| [DH-0143](../DH-0143-web-commands-should-autocomplete.md) | Web: / commands should autocomplete | feature | stefan |
| [DH-0144](../DH-0144-all-recognized-skills-should-be-accessible-as-commands.md) | All recognized skills should be accessible as / commands | feature | stefan |
| [DH-0147](../DH-0147-document-job-as-headless-mode-and-print-a-markdown-transcript-instead-of-just-final-output.md) | Document --job as headless mode; default to a full markdown transcript stream, add --result-only | feature | stefan |
| [DH-0148](../DH-0148-dh-instructions-file-no-job-should-launch-the-interactive-session-first-then-run-the-instructions-live-in-it.md) | dh --instructions <file> (no --job) should launch the interactive session first, then run the instructions live in it | feature | stefan |
| [DH-0165](../DH-0165-e2e-web-browser-chromium-fails-in-real-ci-headless-chromium-can-t-connect-to-d-bus-dom-assertions-never-satisfied.md) | E2E (web/browser — Chromium) fails in real CI: headless Chromium can't connect to D-Bus, DOM assertions never satisfied | bug | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | bug | stefan |
| [DH-0139](../DH-0139-dh-web-is-unusable-remotely-out-of-the-box-dh-0128-auto-points-the-client-at-the-lan-ip-but-the-server-rejects-that-same-ip-by-default-421.md) | dh --web is unusable remotely out of the box: DH-0128 auto-points the client at the LAN IP, but the server rejects that same IP by default (421) | bug | stefan |
| [DH-0149](../DH-0149-replace-shared-process-bun-test-with-per-file-process-isolation-orchestrator-standard-lcov-merge.md) | Replace shared-process bun test with per-file process isolation orchestrator + standard lcov merge | bug | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | feature | stefan |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | feature | stefan |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | bug | stefan |
| [DH-0121](../DH-0121-dh-needs-a-logo-svg-ascii-art-versions.md) | dh needs a logo: SVG + ASCII art versions | feature | stefan |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | feature | stefan |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | feature | stefan |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | feature | stefan |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | bug | stefan |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | bug | stefan |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | feature | stefan |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | bug | stefan |
| [DH-0140](../DH-0140-agent-message-queue.md) | Agents need an incoming-event message queue: mid-turn events (e.g. background sub-agent completions) are currently orphaned, not queued | feature | stefan |
| [DH-0141](../DH-0141-formalize-a-periodic-refactoring-round-mechanism.md) | Formalize a periodic refactoring-round mechanism | feature | stefan |
| [DH-0145](../DH-0145-src-tui-app-test-ts-fails-in-ci-yoga-layout-top-level-await-wasm-init-races-ink-s-synchronous-mount-not-a-dh-0126-ordering-bug.md) | src/tui/app.test.ts fails in CI: yoga-layout top-level-await WASM init races Ink's synchronous mount, not a DH-0126 ordering bug | bug | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0164](../DH-0164-gate-yml-never-installs-playwright-s-chromium-e2e-web-tests-fail-closed-with-no-chromium-found.md) | gate.yml never installs Playwright's Chromium, e2e web tests fail closed with No Chromium found | done |
| [DH-0163](../DH-0163-coverage-backfill-close-the-pre-existing-30-line-gap-across-12-files-99-76-100.md) | Coverage backfill: close the pre-existing ~30-line gap across 12 files (99.76% -> 100%) | done |
| [DH-0162](../DH-0162-gritql-rule-accept-object-freeze-wrapped-values-as-safe-add-autofix-to-wrap-remaining-flagged-consts.md) | GritQL rule: accept Object.freeze()-wrapped values as safe, add autofix to wrap remaining flagged consts | done |
| [DH-0161](../DH-0161-pilot-add-as-const-decorations-to-config-validate-ts-s-private-lookup-consts-resolve-remaining-gritql-warnings.md) | Pilot: add as-const decorations to config/validate.ts's private lookup consts, resolve remaining GritQL warnings | done |
| [DH-0160](../DH-0160-refine-no-module-scope-side-effects-gritql-rule-allow-private-consts-with-literal-as-const-initializers.md) | Refine no-module-scope-side-effects GritQL rule: allow private consts with literal/as-const initializers | done |
| [DH-0159](../DH-0159-coding-standards-overhaul-waves-5-9-root-layer-file-migration-entrypoint-guards-11-files.md) | Coding-standards overhaul Waves 5-9: root-layer file migration + entrypoint guards (11 files) | done |
| [DH-0158](../DH-0158-coding-standards-overhaul-wave-4-layer-3-file-migration-14-files.md) | Coding-standards overhaul Wave 4: layer-3 file migration (14 files) | done |
| [DH-0157](../DH-0157-coding-standards-overhaul-wave-3-layer-2-file-migration-21-files.md) | Coding-standards overhaul Wave 3: layer-2 file migration (21 files) | done |
| [DH-0156](../DH-0156-coding-standards-overhaul-wave-2-layer-1-file-migration-37-files.md) | Coding-standards overhaul Wave 2: layer-1 file migration (37 files) | done |
| [DH-0155](../DH-0155-coding-standards-overhaul-wave-1-leaf-layer-file-migration-60-files-layer-0.md) | Coding-standards overhaul Wave 1: leaf-layer file migration (60 files, layer 0) | done |
| [DH-0154](../DH-0154-gritql-custom-lint-rule-enforce-type-ts-constant-ts-export-restrictions-and-no-side-effects-at-module-scope.md) | GritQL custom lint rule: enforce .type.ts/.constant.ts export restrictions and no-side-effects-at-module-scope | done |
| [DH-0153](../DH-0153-break-the-agent-runtime-ts-agent-resume-ts-dependency-cycle.md) | Break the agent/runtime.ts <-> agent/resume.ts dependency cycle | done |
| [DH-0152](../DH-0152-coverage-exclusion-mechanism-for-future-type-ts-constant-ts-files-fix-contracts-index-test-ts-fake-import-workaround.md) | Coverage-exclusion mechanism for future .type.ts / .constant.ts files, fix contracts/index.test.ts fake-import workaround | done |
| [DH-0151](../DH-0151-upgrade-biome-1-9-4-to-2-x-migrate-config-absorb-import-sort-baseline-reformat.md) | Upgrade Biome 1.9.4 to 2.x, migrate config, absorb import-sort baseline reformat | done |
| [DH-0150](../DH-0150-dh-0149-follow-up-per-file-lcov-merge-inflates-lf-with-comment-line-pollution-replace-lcov-a-with-max-lh-part-merge.md) | DH-0149 follow-up: per-file lcov merge inflates LF with comment-line pollution, replace lcov -a with max-LH-part merge | done |
