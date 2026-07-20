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
| [DH-0057](../DH-0057-mcp-oauth-support-via-mcpauth-tool.md) | MCP OAuth support via McpAuth tool | status: verifying |
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions | deferred (2026-07-16): GitHub issue #7 created to gauge demand |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | status: verifying |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | status: verifying |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | status: verifying |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | status: verifying |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | status: verifying |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | status: verifying |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | status: verifying |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | status: verifying |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | status: verifying |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | status: verifying |
| [DH-0175](../DH-0175-remove-or-formally-sunset-the-deprecated-task-failed-text-marker-self-report-path.md) | Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path | status: refining |
| [DH-0219](../DH-0219-new-dh-monogram-logo-uppercase-d-h-replaces-diamond-evolution-direction.md) | New DH monogram logo (uppercase D+H, replaces diamond-evolution direction) | status: verifying |
| [DH-0220](../DH-0220-dual-mode-startup-header-redesign-a2-interactive-b-web-headless.md) | Dual-mode startup header redesign: A2 (interactive) + B (web/headless) | status: verifying |
| [DH-0221](../DH-0221-truecolor-brand-palette-color-level-resolver-shared-color-infrastructure.md) | Truecolor brand palette + color-level resolver (shared color infrastructure) | status: verifying |
| [DH-0224](../DH-0224-brand-rebrand-only-reached-the-startup-header-doctor-init-tui-web-still-render-the-old-dh-ascii-logo-figlet.md) | Brand rebrand only reached the startup header; doctor/init/TUI/Web still render the old DH_ASCII_LOGO figlet | status: verifying |
| [DH-0226](../DH-0226-workflow-tool-mvp-deterministic-sub-agent-orchestration-script-agent-parallel.md) | Workflow tool MVP: deterministic sub-agent orchestration script (agent() + parallel()) | status: verifying |
| [DH-0227](../DH-0227-readme-hero-restructure-hoist-product-screenshot-and-tagline-above-the-fold.md) | README hero restructure: hoist product screenshot and tagline above the fold | status: verifying |
| [DH-0228](../DH-0228-github-social-preview-image-1280x640-og-image-checked-into-docs-media.md) | GitHub social-preview image (1280×640 og:image) checked into docs/media | status: verifying |
| [DH-0233](../DH-0233-system-prompt-does-not-document-colored-span-feature.md) | System prompt does not document colored-span feature (DH-0206 implementation gap) | DH-0206 |
| [DH-0234](../DH-0234-system-prompt-does-not-document-workflow-tool.md) | System prompt does not document Workflow tool | DH-0226 |

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
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions 🔒 | feature | stefan |
| [DH-0213](../DH-0213-research-dh-native-workflow-tool-workflow-command-modeled-on-claude-code-s-workflow-tool.md) | Research: dh-native Workflow tool + /workflow command, modeled on Claude Code's Workflow tool | feature | stefan |
| [DH-0229](../DH-0229-ascii-art-blocks-need-monospace-color-support-in-web-and-system-prompt-guidance.md) | ASCII art blocks need monospace + color support in web and system prompt guidance | feature | stefan |

### refining

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0175](../DH-0175-remove-or-formally-sunset-the-deprecated-task-failed-text-marker-self-report-path.md) | Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path | bug | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0139](../DH-0139-dh-web-is-unusable-remotely-out-of-the-box-dh-0128-auto-points-the-client-at-the-lan-ip-but-the-server-rejects-that-same-ip-by-default-421.md) | dh --web is unusable remotely out of the box: DH-0128 auto-points the client at the LAN IP, but the server rejects that same IP by default (421) | bug | stefan |
| [DH-0149](../DH-0149-replace-shared-process-bun-test-with-per-file-process-isolation-orchestrator-standard-lcov-merge.md) | Replace shared-process bun test with per-file process isolation orchestrator + standard lcov merge | bug | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0057](../DH-0057-mcp-oauth-support-via-mcpauth-tool.md) | MCP OAuth support via McpAuth tool | feature | stefan |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | feature | stefan |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | bug | stefan |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | feature | stefan |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | bug | stefan |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | feature | stefan |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | feature | stefan |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | bug | stefan |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | bug | stefan |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | feature | stefan |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | bug | stefan |
| [DH-0219](../DH-0219-new-dh-monogram-logo-uppercase-d-h-replaces-diamond-evolution-direction.md) | New DH monogram logo (uppercase D+H, replaces diamond-evolution direction) | feature | stefan |
| [DH-0220](../DH-0220-dual-mode-startup-header-redesign-a2-interactive-b-web-headless.md) | Dual-mode startup header redesign: A2 (interactive) + B (web/headless) | feature | stefan |
| [DH-0221](../DH-0221-truecolor-brand-palette-color-level-resolver-shared-color-infrastructure.md) | Truecolor brand palette + color-level resolver (shared color infrastructure) | feature | stefan |
| [DH-0224](../DH-0224-brand-rebrand-only-reached-the-startup-header-doctor-init-tui-web-still-render-the-old-dh-ascii-logo-figlet.md) | Brand rebrand only reached the startup header; doctor/init/TUI/Web still render the old DH_ASCII_LOGO figlet | bug | stefan |
| [DH-0226](../DH-0226-workflow-tool-mvp-deterministic-sub-agent-orchestration-script-agent-parallel.md) | Workflow tool MVP: deterministic sub-agent orchestration script (agent() + parallel()) | feature | stefan |
| [DH-0227](../DH-0227-readme-hero-restructure-hoist-product-screenshot-and-tagline-above-the-fold.md) | README hero restructure: hoist product screenshot and tagline above the fold | feature | Iris |
| [DH-0228](../DH-0228-github-social-preview-image-1280x640-og-image-checked-into-docs-media.md) | GitHub social-preview image (1280×640 og:image) checked into docs/media | feature | Iris |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0225](../DH-0225-startup-header-health-dot-green-diverges-from-status-tokens-status-dot-green-dh-0221-palette-fragmentation.md) | Startup-header health dot green diverges from STATUS_TOKENS status-dot green (DH-0221 palette fragmentation) | done |
| [DH-0223](../DH-0223-chooseheadermode-is-exported-and-unit-tested-but-never-called-at-runtime.md) | chooseHeaderMode is exported and unit-tested but never called at runtime | done |
| [DH-0222](../DH-0222-refactoring-round-dh-0219-0220-0221-logo-header-color-wave-sweep.md) | Refactoring round: DH-0219/0220/0221 logo+header+color wave sweep | done |
| [DH-0218](../DH-0218-renderselfinfosection-signature-accreted-into-positional-optional-trap-across-dh-0094-0194-0215.md) | renderSelfInfoSection signature accreted into positional-optional trap across DH-0094/0194/0215 | done |
| [DH-0217](../DH-0217-spile-ops-new-ticket-py-counter-is-unsafe-for-concurrent-isolated-worktrees-id-collisions.md) | spile-ops new_ticket.py counter is unsafe for concurrent isolated worktrees — ID collisions | done |
| [DH-0216](../DH-0216-refactoring-round-post-p0-fixes-and-workflow-self-awareness-feature-sweep.md) | Refactoring round: post-P0-fixes and Workflow/self-awareness feature sweep | done |
| [DH-0215](../DH-0215-teach-agents-their-own-sessionid-agentid-log-path-jsonl-log-structure-in-the-system-prompt.md) | Teach agents their own sessionId/agentId/log path + JSONL log structure in the system prompt | done |
| [DH-0214](../DH-0214-tui-precomposed-accented-char-extra-combining-mark-drops-the-next-rendered-character.md) | TUI: precomposed accented char + extra combining mark drops the next rendered character | done |
| [DH-0212](../DH-0212-dh-0060-tui-spike-suite-regressed-from-16-0-to-9-7-pass-fail-needs-real-triage-before-treating-as-regressions.md) | DH-0060 TUI spike suite regressed from 16/0 to 9/7 pass/fail -- needs real triage before treating as regressions | done |
| [DH-0211](../DH-0211-both-uis-pressing-escape-should-stop-the-currently-running-agent.md) | Both UIs: pressing Escape should stop the currently running agent | done |
| [DH-0210](../DH-0210-import-resume-chain-toolresult-tooluse-block-count-mismatch-crashes-the-provider-request.md) | --import + resume chain: toolResult/toolUse block count mismatch crashes the provider request | done |
| [DH-0209](../DH-0209-sub-agents-may-lack-access-to-reportoutcome-falling-back-to-task-failed-confusion.md) | Sub-agents may lack access to ReportOutcome, falling back to TASK_FAILED confusion | duplicate |
| [DH-0208](../DH-0208-message-queue-script-hangs-indefinitely-with-no-completion-eof-signal.md) | Message queue: script hangs indefinitely with no completion/EOF signal | done |
| [DH-0207](../DH-0207-message-queue-queued-messages-need-visual-queued-state-delete-cancel-capability.md) | Message queue: queued messages need visual 'queued' state + delete/cancel capability | done |
| [DH-0206](../DH-0206-markdown-no-inline-html-support-consider-basic-span-style-color-as-a-safe-subset.md) | Markdown: no inline HTML support -- consider basic <span style=color> as a safe subset | done |
