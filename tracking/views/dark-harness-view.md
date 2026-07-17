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
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | feature | stefan |
| [DH-0121](../DH-0121-dh-needs-a-logo-svg-ascii-art-versions.md) | dh needs a logo: SVG + ASCII art versions | feature | stefan |
| [DH-0122](../DH-0122-every-dh-run-should-print-an-application-header-name-logo-version-build-config-status.md) | Every dh run should print an application header (name, logo, version/build, config status) | feature | stefan |
| [DH-0123](../DH-0123-dh-init-output-doesn-t-look-great.md) | dh init output doesn't look great | bug | stefan |
| [DH-0124](../DH-0124-tui-empty-state-before-first-message-is-misleading-show-app-header-friendlier-prompt.md) | TUI empty-state before first message is misleading -- show app header + friendlier prompt | feature | stefan |
| [DH-0125](../DH-0125-tui-add-a-status-row-under-the-input-box-model-progress-git-branch-path.md) | TUI: add a status row under the input box (model, progress, git branch/path) | feature | stefan |
| [DH-0126](../DH-0126-urgent-tui-mouse-scroll-wheel-fills-the-input-textbox-with-garbage-instead-of-scrolling-history.md) | URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history | bug | stefan |
| [DH-0127](../DH-0127-web-ui-has-heavy-visual-flicker-no-virtual-dom-diffing-sections-fully-rebuilt-on-every-render.md) | Web UI has heavy visual flicker -- no virtual-DOM diffing, sections fully rebuilt on every render | feature | stefan |
| [DH-0128](../DH-0128-urgent-web-ui-connecting-from-a-separate-machine-loads-the-shell-but-sticks-on-reconnecting.md) | URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...' | bug | stefan |
| [DH-0129](../DH-0129-web-transcript-should-auto-scroll-to-bottom-only-when-already-at-the-bottom.md) | Web transcript should auto-scroll to bottom only when already at the bottom | feature | stefan |
| [DH-0130](../DH-0130-sub-agent-terminal-status-failed-done-stopped-has-no-in-transcript-marker.md) | Sub-agent terminal status (failed/done/stopped) has no in-transcript marker | bug | stefan |
| [DH-0131](../DH-0131-sub-agent-failure-transitions-are-not-recorded-in-the-jsonl-log-as-a-structured-status-change-event.md) | Sub-agent failure transitions are not recorded in the JSONL log as a structured status_change event | bug | stefan |
| [DH-0132](../DH-0132-adopt-a-convention-of-writing-acceptance-tests-as-prompts-run-via-dh-job-for-real-end-to-end-verification.md) | Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification | feature | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0115](../DH-0115-e2e-reportoutcome-nudge-doubling-successturn-taskfailedturn-mock-helpers-predate-dh-0050.md) | e2e ReportOutcome-nudge doubling: successTurn/taskFailedTurn mock helpers predate DH-0050 | bug | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0120](../DH-0120-openai-compatible-provider-omitted-required-type-function-on-outgoing-tool-calls.md) | openai-compatible provider omitted required type:function on outgoing tool_calls | done |
| [DH-0119](../DH-0119-real-bedrock-mantle-integration-live-verified-mantle-anthropic-mantle-openai.md) | Real Bedrock Mantle integration, live-verified: mantle-anthropic + mantle-openai | done |
| [DH-0118](../DH-0118-amazon-bedrock-mantle-is-a-real-separate-endpoint-wire-it-up-as-its-own-provider-not-folded-into-bedrock.md) | Amazon Bedrock Mantle is a real, separate endpoint -- wire it up as its own provider, not folded into bedrock | done |
| [DH-0117](../DH-0117-web-ui-redraw-storm-composer-textarea-rebuilt-every-second-wiping-focus-and-unsent-text.md) | Web UI redraw-storm: composer textarea rebuilt every second, wiping focus and unsent text | done |
| [DH-0116](../DH-0116-server-mode-s-agentruntime-sessionid-mismatches-the-outer-logdir-cli-ts-uses.md) | --server mode's AgentRuntime sessionId mismatches the outer logDir cli.ts uses | done |
| [DH-0114](../DH-0114-launch-sub-agents-as-real-claude-cli-subprocesses-in-the-target-worktree-not-in-process-agent-tool.md) | Launch sub-agents as real claude CLI subprocesses in the target worktree, not in-process Agent tool | done |
| [DH-0113](../DH-0113-coordinator-gate-checks-should-be-a-checked-in-sub-agent-prompt-not-run-inline.md) | Coordinator gate checks should be a checked-in sub-agent prompt, not run inline | done |
| [DH-0112](../DH-0112-e2e-support-mock-provider-ts-never-updated-for-dh-0044-s-mandatory-streaming-real-turns-hang-past-agent-status.md) | e2e/support/mock-provider.ts never updated for DH-0044's mandatory streaming -- real turns hang past agent_status | done |
| [DH-0111](../DH-0111-dh-connect-web-malforms-the-target-url-http-http-localhost.md) | dh --connect --web malforms the target URL (http://http://localhost...) | done |
| [DH-0110](../DH-0110-urgent-web-ui-completely-broken-dh-0023-s-security-header-workaround-lost-bun-s-chunk-asset-routing.md) | URGENT: Web UI completely broken -- DH-0023's security-header workaround lost Bun's chunk-asset routing | done |
| [DH-0108](../DH-0108-comprehensive-markdown-rendering-test-suite-tui-web.md) | Comprehensive Markdown rendering test suite (TUI+Web) | done |
| [DH-0107](../DH-0107-real-gemma-4-support-requires-a-new-provider-type-bedrock-mantle-openai-compatible-api.md) | Real Gemma 4 support requires a new provider type (Bedrock Mantle, OpenAI-compatible API) | done |
| [DH-0106](../DH-0106-gemma4-bedrock-default-model-hallucinates-tool-calls-instead-of-making-them.md) | dh init's scaffolded "gemma4" is actually Gemma 3 (wrong model), and hallucinates tool calls | done |
| [DH-0105](../DH-0105-unify-connection-state-and-status-vocabulary-across-tui-and-web.md) | Unify connection-state and status vocabulary across TUI and Web | done |
| [DH-0104](../DH-0104-unify-number-cost-elapsed-and-token-formatting-across-tui-web-and-cli.md) | Unify number, cost, elapsed, and token formatting across TUI, Web, and CLI | done |
