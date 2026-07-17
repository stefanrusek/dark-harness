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
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut | waiting on a real release/binary to exist before this can be written accurately |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | status: verifying |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | status: verifying |
| [DH-0121](../DH-0121-dh-needs-a-logo-svg-ascii-art-versions.md) | dh needs a logo: SVG + ASCII art versions | status: verifying |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | status: verifying |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | blocked on DH-0133 (UI overhaul: React/Ink migration) -- current-architecture implementation would be redone afterward |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | status: verifying |
| [DH-0135](../DH-0135-ui-overhaul-phase-2-migrate-web-client-to-react.md) | UI overhaul phase 2: migrate Web client to React | blocked on DH-0133a (Core toolchain) landing first |
| [DH-0136](../DH-0136-ui-overhaul-phase-2-migrate-tui-to-ink.md) | UI overhaul phase 2: migrate TUI to Ink | blocked on DH-0133a (Core toolchain) landing first |

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
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut 🔒 | feature | stefan |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | bug | stefan |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom 🔒 | feature | stefan |
| [DH-0132](../DH-0132-adopt-a-convention-of-writing-acceptance-tests-as-prompts-run-via-dh-job-for-real-end-to-end-verification.md) | Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification | feature | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | feature | stefan |
| [DH-0140](../DH-0140-agent-message-queue.md) | Agents need an incoming-event message queue: mid-turn events (e.g. background sub-agent completions) are currently orphaned, not queued | feature | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | feature | stefan |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | feature | stefan |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | bug | stefan |
| [DH-0139](../DH-0139-dh-web-is-unusable-remotely-out-of-the-box-dh-0128-auto-points-the-client-at-the-lan-ip-but-the-server-rejects-that-same-ip-by-default-421.md) | dh --web is unusable remotely out of the box: DH-0128 auto-points the client at the LAN IP, but the server rejects that same IP by default (421) | bug | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | feature | stefan |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | bug | stefan |
| [DH-0121](../DH-0121-dh-needs-a-logo-svg-ascii-art-versions.md) | dh needs a logo: SVG + ASCII art versions | feature | stefan |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | bug | stefan |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | bug | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0138](../DH-0138-web-fix-flexbox-grid-layout-so-main-pane-fills-remaining-width-next-to-sidebar.md) | Web: fix flexbox/grid layout so main-pane fills remaining width next to sidebar | done |
| [DH-0137](../DH-0137-shared-design-token-module-for-status-connection-color-glyph-consumed-by-both-react-and-ink-component-trees.md) | Shared design-token module for status/connection color+glyph, consumed by both React and Ink component trees | done |
| [DH-0136](../DH-0136-ui-overhaul-phase-2-migrate-tui-to-ink.md) | UI overhaul phase 2: migrate TUI to Ink | done |
| [DH-0135](../DH-0135-ui-overhaul-phase-2-migrate-web-client-to-react.md) | UI overhaul phase 2: migrate Web client to React | done |
| [DH-0134](../DH-0134-ui-overhaul-phase-1-core-toolchain-integration-for-react-ink.md) | UI overhaul phase 1: Core toolchain integration for React + Ink | done |
| [DH-0133](../DH-0133-ui-overhaul-migrate-web-to-react-tui-to-ink.md) | UI overhaul: migrate Web to React, TUI to Ink | done |
| [DH-0130](../DH-0130-sub-agent-terminal-status-failed-done-stopped-has-no-in-transcript-marker.md) | Sub-agent terminal status (failed/done/stopped) has no in-transcript marker | done |
| [DH-0127](../DH-0127-web-ui-has-heavy-visual-flicker-no-virtual-dom-diffing-sections-fully-rebuilt-on-every-render.md) | Web UI has heavy visual flicker -- no virtual-DOM diffing, sections fully rebuilt on every render | superseded |
| [DH-0120](../DH-0120-openai-compatible-provider-omitted-required-type-function-on-outgoing-tool-calls.md) | openai-compatible provider omitted required type:function on outgoing tool_calls | done |
| [DH-0119](../DH-0119-real-bedrock-mantle-integration-live-verified-mantle-anthropic-mantle-openai.md) | Real Bedrock Mantle integration, live-verified: mantle-anthropic + mantle-openai | done |
| [DH-0118](../DH-0118-amazon-bedrock-mantle-is-a-real-separate-endpoint-wire-it-up-as-its-own-provider-not-folded-into-bedrock.md) | Amazon Bedrock Mantle is a real, separate endpoint -- wire it up as its own provider, not folded into bedrock | done |
| [DH-0117](../DH-0117-web-ui-redraw-storm-composer-textarea-rebuilt-every-second-wiping-focus-and-unsent-text.md) | Web UI redraw-storm: composer textarea rebuilt every second, wiping focus and unsent text | done |
| [DH-0116](../DH-0116-server-mode-s-agentruntime-sessionid-mismatches-the-outer-logdir-cli-ts-uses.md) | --server mode's AgentRuntime sessionId mismatches the outer logDir cli.ts uses | done |
| [DH-0114](../DH-0114-launch-sub-agents-as-real-claude-cli-subprocesses-in-the-target-worktree-not-in-process-agent-tool.md) | Launch sub-agents as real claude CLI subprocesses in the target worktree, not in-process Agent tool | done |
| [DH-0113](../DH-0113-coordinator-gate-checks-should-be-a-checked-in-sub-agent-prompt-not-run-inline.md) | Coordinator gate checks should be a checked-in sub-agent prompt, not run inline | done |
