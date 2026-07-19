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
| [DH-0199](../DH-0199-web-consecutive-tool-calls-should-group-into-a-collapsible-expando.md) | Web: consecutive tool calls should group into a collapsible expando | feature | stefan |
| [DH-0200](../DH-0200-web-jump-to-latest-button-disappears-after-mouse-wheel-scroll-doesn-t-reappear-consistently.md) | Web: 'Jump to Latest' button disappears after mouse-wheel scroll, doesn't reappear consistently | bug | stefan |
| [DH-0206](../DH-0206-markdown-no-inline-html-support-consider-basic-span-style-color-as-a-safe-subset.md) | Markdown: no inline HTML support -- consider basic <span style=color> as a safe subset | feature | stefan |
| [DH-0213](../DH-0213-research-dh-native-workflow-tool-workflow-command-modeled-on-claude-code-s-workflow-tool.md) | Research: dh-native Workflow tool + /workflow command, modeled on Claude Code's Workflow tool | feature | stefan |

### refining

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0175](../DH-0175-remove-or-formally-sunset-the-deprecated-task-failed-text-marker-self-report-path.md) | Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path | bug | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0192](../DH-0192-logo-redesign-current-mark-is-too-literal-and-reads-unintentionally-suggestive.md) | Brand mark — standardize the diamond on ink (not amber), and redraw the ASCII banner to the bracket lockup | bug | stefan |
| [DH-0193](../DH-0193-wordmark-needs-more-padding-wherever-it-s-plugged-in-next-to-the-logo.md) | Wordmark needs more padding wherever it's plugged in next to the logo | bug | stefan |
| [DH-0198](../DH-0198-web-ui-header-never-actually-renders-the-brand-mark-logo-asset.md) | Web UI header never actually renders the brand mark/logo asset | bug | stefan |
| [DH-0201](../DH-0201-web-switching-to-view-a-sub-agent-erases-the-pending-unsent-operator-message.md) | Web: switching to view a sub-agent erases the pending (unsent) operator message | bug | stefan |
| [DH-0202](../DH-0202-web-model-name-shows-unknown-model-after-sse-reconnect.md) | Web: model name shows '(unknown model)' after SSE reconnect | bug | stefan |
| [DH-0203](../DH-0203-markdown-h3-h6-headers-render-visually-identical-no-hierarchy.md) | Markdown: H3-H6 headers render visually identical, no hierarchy | bug | stefan |
| [DH-0204](../DH-0204-markdown-link-title-attribute-leaks-into-the-href.md) | Markdown: link title attribute leaks into the href | bug | stefan |
| [DH-0205](../DH-0205-markdown-escaped-characters-render-their-literal-backslash.md) | Markdown: escaped characters render their literal backslash | bug | stefan |
| [DH-0207](../DH-0207-message-queue-queued-messages-need-visual-queued-state-delete-cancel-capability.md) | Message queue: queued messages need visual 'queued' state + delete/cancel capability | feature | stefan |
| [DH-0208](../DH-0208-message-queue-script-hangs-indefinitely-with-no-completion-eof-signal.md) | Message queue: script hangs indefinitely with no completion/EOF signal | bug | stefan |
| [DH-0214](../DH-0214-tui-precomposed-accented-char-extra-combining-mark-drops-the-next-rendered-character.md) | TUI: precomposed accented char + extra combining mark drops the next rendered character | bug | stefan |

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
| [DH-0218](../DH-0218-renderselfinfosection-signature-accreted-into-positional-optional-trap-across-dh-0094-0194-0215.md) | renderSelfInfoSection signature accreted into positional-optional trap across DH-0094/0194/0215 | done |
| [DH-0217](../DH-0217-spile-ops-new-ticket-py-counter-is-unsafe-for-concurrent-isolated-worktrees-id-collisions.md) | spile-ops new_ticket.py counter is unsafe for concurrent isolated worktrees — ID collisions | done |
| [DH-0216](../DH-0216-refactoring-round-post-p0-fixes-and-workflow-self-awareness-feature-sweep.md) | Refactoring round: post-P0-fixes and Workflow/self-awareness feature sweep | done |
| [DH-0215](../DH-0215-teach-agents-their-own-sessionid-agentid-log-path-jsonl-log-structure-in-the-system-prompt.md) | Teach agents their own sessionId/agentId/log path + JSONL log structure in the system prompt | done |
| [DH-0212](../DH-0212-dh-0060-tui-spike-suite-regressed-from-16-0-to-9-7-pass-fail-needs-real-triage-before-treating-as-regressions.md) | DH-0060 TUI spike suite regressed from 16/0 to 9/7 pass/fail -- needs real triage before treating as regressions | done |
| [DH-0211](../DH-0211-both-uis-pressing-escape-should-stop-the-currently-running-agent.md) | Both UIs: pressing Escape should stop the currently running agent | done |
| [DH-0210](../DH-0210-import-resume-chain-toolresult-tooluse-block-count-mismatch-crashes-the-provider-request.md) | --import + resume chain: toolResult/toolUse block count mismatch crashes the provider request | done |
| [DH-0209](../DH-0209-sub-agents-may-lack-access-to-reportoutcome-falling-back-to-task-failed-confusion.md) | Sub-agents may lack access to ReportOutcome, falling back to TASK_FAILED confusion | duplicate |
| [DH-0197](../DH-0197-post-cli-split-residual-doc-style-seams-in-core-stale-function-refs-help-ts-sgr-literal.md) | Post-cli-split residual doc/style seams in Core (stale function refs + help.ts SGR literal) | done |
| [DH-0196](../DH-0196-refactoring-round-post-cli-ts-split-and-second-wave-feature-sweep.md) | Refactoring round: post-cli.ts-split and second-wave feature sweep | done |
| [DH-0195](../DH-0195-readme-stale-missing-web-port-host-import-model-and-slash-command-autocomplete.md) | README stale: missing --web-port, --host, --import/--model, and slash-command autocomplete | done |
| [DH-0194](../DH-0194-agent-should-know-when-running-non-interactively-job-and-adjust-behavior-accordingly.md) | Agent should know when running non-interactively (--job) and adjust behavior accordingly | done |
| [DH-0191](../DH-0191-consolidate-hand-rolled-status-color-sgr-tables-onto-design-tokens-ts-and-extract-a-shared-sgr-primitive.md) | Consolidate hand-rolled status-color/SGR tables onto design-tokens.ts and extract a shared SGR primitive | done |
| [DH-0190](../DH-0190-refactoring-round-post-dh-0170-chain-sweep-focus-on-cli-ts-decomposition.md) | Refactoring round: post-DH-0170-chain sweep, focus on cli.ts decomposition | done |
| [DH-0189](../DH-0189-import-import-cli-flag-mode-composition-model-selection-core.md) | import: --import CLI flag, mode composition, model selection (Core) | done |
