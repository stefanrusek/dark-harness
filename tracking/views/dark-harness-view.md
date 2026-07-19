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
| [DH-0166](../DH-0166-tui-mode-binds-a-real-network-server-it-doesn-t-need.md) | TUI mode binds a real network server it doesn't need | needs architect (Fable) sign-off per CLAUDE.md section 6 item 4 — touches security posture |
| [DH-0175](../DH-0175-remove-or-formally-sunset-the-deprecated-task-failed-text-marker-self-report-path.md) | Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path | status: refining |

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
| [DH-0166](../DH-0166-tui-mode-binds-a-real-network-server-it-doesn-t-need.md) | TUI mode binds a real network server it doesn't need 🔒 | bug | stefan |
| [DH-0174](../DH-0174-split-cli-ts-2041-lines-into-focused-modules-and-extract-a-shared-ansi-color-primitive.md) | Split cli.ts (2041 lines) into focused modules and extract a shared ANSI/color primitive | bug | stefan |
| [DH-0191](../DH-0191-consolidate-hand-rolled-status-color-sgr-tables-onto-design-tokens-ts-and-extract-a-shared-sgr-primitive.md) | Consolidate hand-rolled status-color/SGR tables onto design-tokens.ts and extract a shared SGR primitive | bug | stefan |
| [DH-0192](../DH-0192-logo-redesign-current-mark-is-too-literal-and-reads-unintentionally-suggestive.md) | Logo redesign: current mark is too literal and reads unintentionally suggestive | bug | stefan |
| [DH-0193](../DH-0193-wordmark-needs-more-padding-wherever-it-s-plugged-in-next-to-the-logo.md) | Wordmark needs more padding wherever it's plugged in next to the logo | bug | stefan |

### refining

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0175](../DH-0175-remove-or-formally-sunset-the-deprecated-task-failed-text-marker-self-report-path.md) | Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path | bug | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0142](../DH-0142-tui-commands-should-autocomplete.md) | TUI: / commands should autocomplete | feature | stefan |
| [DH-0143](../DH-0143-web-commands-should-autocomplete.md) | Web: / commands should autocomplete | feature | stefan |
| [DH-0144](../DH-0144-all-recognized-skills-should-be-accessible-as-commands.md) | All recognized skills should be accessible as / commands | feature | stefan |
| [DH-0147](../DH-0147-document-job-as-headless-mode-and-print-a-markdown-transcript-instead-of-just-final-output.md) | Document --job as headless mode; default to a full markdown transcript stream, add --result-only | feature | stefan |
| [DH-0148](../DH-0148-dh-instructions-file-no-job-should-launch-the-interactive-session-first-then-run-the-instructions-live-in-it.md) | dh --instructions <file> (no --job) should launch the interactive session first, then run the instructions live in it | feature | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | bug | stefan |
| [DH-0132](../DH-0132-adopt-a-convention-of-writing-acceptance-tests-as-prompts-run-via-dh-job-for-real-end-to-end-verification.md) | Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification | feature | stefan |
| [DH-0139](../DH-0139-dh-web-is-unusable-remotely-out-of-the-box-dh-0128-auto-points-the-client-at-the-lan-ip-but-the-server-rejects-that-same-ip-by-default-421.md) | dh --web is unusable remotely out of the box: DH-0128 auto-points the client at the LAN IP, but the server rejects that same IP by default (421) | bug | stefan |
| [DH-0149](../DH-0149-replace-shared-process-bun-test-with-per-file-process-isolation-orchestrator-standard-lcov-merge.md) | Replace shared-process bun test with per-file process isolation orchestrator + standard lcov merge | bug | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | feature | stefan |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | feature | stefan |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | bug | stefan |
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
| [DH-0194](../DH-0194-agent-should-know-when-running-non-interactively-job-and-adjust-behavior-accordingly.md) | Agent should know when running non-interactively (--job) and adjust behavior accordingly | done |
| [DH-0190](../DH-0190-refactoring-round-post-dh-0170-chain-sweep-focus-on-cli-ts-decomposition.md) | Refactoring round: post-DH-0170-chain sweep, focus on cli.ts decomposition | done |
| [DH-0189](../DH-0189-import-import-cli-flag-mode-composition-model-selection-core.md) | import: --import CLI flag, mode composition, model selection (Core) | done |
| [DH-0188](../DH-0188-import-claude-code-session-translation-jsonl-writer-server.md) | import: Claude Code session translation + JSONL writer (Server) | done |
| [DH-0187](../DH-0187-import-import-a-claude-code-session-directory-into-dh.md) | --import: import a Claude Code session directory into dh | done |
| [DH-0186](../DH-0186-migrate-the-web-sse-client-onto-the-shared-src-client-core-transport.md) | Migrate the Web SSE client onto the shared src/client-core/ transport | done |
| [DH-0185](../DH-0185-migrate-the-tui-sse-client-onto-the-shared-src-client-core-transport.md) | Migrate the TUI SSE client onto the shared src/client-core/ transport | done |
| [DH-0184](../DH-0184-extract-the-shared-sse-transport-frame-parser-full-jitter-backoff-last-event-id-reconnect-payload-validation-into-src-client-core-resolving-the-validation-strictness-divergence.md) | Extract the shared SSE transport (frame parser + full-jitter backoff + Last-Event-ID reconnect + payload validation) into src/client-core/, resolving the validation-strictness divergence | done |
| [DH-0183](../DH-0183-establish-src-client-core-and-consolidate-the-zero-coupling-shared-client-primitives-slash-command-parser-connectionstatus-vocabulary.md) | Establish src/client-core/ and consolidate the zero-coupling shared client primitives (slash-command parser + ConnectionStatus vocabulary) | done |
| [DH-0182](../DH-0182-add-a-cli-flag-to-override-security-hostname-overriding-config.md) | Add a CLI flag to override security.hostname, overriding config | done |
| [DH-0181](../DH-0181-extract-a-shared-tree-connector-prefix-helper-for-the-dh-logs-dump-and-the-tui-tree.md) | Extract a shared tree-connector prefix helper for the dh logs dump and the TUI tree | done |
| [DH-0180](../DH-0180-relocate-fakeagentloop-out-of-the-production-server-entrypoint-into-test-only-scope.md) | Relocate FakeAgentLoop out of the production server entrypoint into test-only scope | done |
| [DH-0179](../DH-0179-revisit-web-static-server-dual-typecheck-split-to-remove-the-loopback-self-proxy-and-any-casts.md) | Revisit web static-server dual-typecheck split to remove the loopback self-proxy and any-casts | done |
| [DH-0178](../DH-0178-de-duplicate-bun-setup-install-steps-and-centralize-the-pinned-bun-version-across-ci-workflows.md) | De-duplicate Bun setup/install steps and centralize the pinned bun-version across CI workflows | done |
| [DH-0177](../DH-0177-e2e-test-support-cleanup-consolidate-mock-provider-scaffolding-and-resolve-the-spikes-tree-s-status-and-gate-dependency.md) | e2e test-support cleanup: consolidate mock-provider scaffolding and resolve the spikes/ tree's status and gate dependency | done |
