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
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary | status: verifying |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance | deferred (owner decision 2026-07-15): no incident behind this, revisit near real release cut |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows | deferred (owner decision 2026-07-16): cutting for now, real feature wanted later — GitHub issue #8 created to gauge demand |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback | deferred (owner decision 2026-07-15): sweep-sourced idea, not a real requested need |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability | deferred (2026-07-15): sweep-sourced, no observed fleet-ops need |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents | deferred (2026-07-15): reactive retry sufficient so far |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs | deferred (2026-07-15): sweep-sourced, no observed need |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI | deferred, revisit soon (2026-07-15) |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute | deferred (2026-07-15): no observed sustained-outage incident, same as DH-0049 |
| [DH-0061](../DH-0061-web-overnight-behavioral-test-agent-playwright-screenshot-verification-suite.md) | Web overnight behavioral test agent: Playwright screenshot verification suite | status: verifying |
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
| [DH-0068](../DH-0068-readme-hero-compelling-promo-screenshot-and-visual-identity-for-the-landing-page.md) | README hero: compelling promo screenshot and visual identity for the landing page | feature | stefan |
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions 🔒 | feature | stefan |
| [DH-0088](../DH-0088-update-readme-with-real-download-install-instructions-once-release-binaries-are-cut.md) | Update README with real download/install instructions once release binaries are cut 🔒 | feature | stefan |
| [DH-0109](../DH-0109-missing-markdown-features-gfm-table-rendering-and-other-explicitly-out-of-scope-constructs.md) | Missing Markdown features: GFM table rendering (and other explicitly-out-of-scope constructs) | feature | stefan |
| [DH-0111](../DH-0111-dh-connect-web-malforms-the-target-url-http-http-localhost.md) | dh --connect --web malforms the target URL (http://http://localhost...) | bug | stefan |
| [DH-0113](../DH-0113-coordinator-gate-checks-should-be-a-checked-in-sub-agent-prompt-not-run-inline.md) | Coordinator gate checks should be a checked-in sub-agent prompt, not run inline | feature | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0003](../DH-0003-sendmessage-resume-finished-conversation.md) | `SendMessage` should resume a finished agent's conversation, not just error cleanly | feature | stefan |
| [DH-0010](../DH-0010-no-context-window-compaction-or-cache-control.md) | No context-window compaction/token-budget handling, and no prompt caching (`cache_control`) | feature | stefan |
| [DH-0012](../DH-0012-unbounded-memory-growth-across-harness.md) | Unbounded in-memory growth across the harness for long/wide-fanout runs | bug | stefan |
| [DH-0020](../DH-0020-jsonl-logger-robustness-and-secrets-redaction.md) | JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O | bug | stefan |
| [DH-0025](../DH-0025-tui-terminal-safety-and-rendering-correctness.md) | TUI wide-character/resize/redraw rendering bugs | bug | stefan |
| [DH-0040](../DH-0040-bash-env-secrets-exposure-and-provider-error-redaction.md) | Bash tool's full-environment inheritance and unredacted provider error messages are undocumented secrets-exposure vectors | bug | stefan |
| [DH-0044](../DH-0044-no-streaming-partial-output.md) | No streaming of partial model output — `agent_output` events only fire once per completed turn | feature | stefan |
| [DH-0045](../DH-0045-no-extended-thinking-support.md) | No extended-thinking (interleaved/extended thinking blocks) support | feature | stefan |
| [DH-0089](../DH-0089-no-tool-call-sse-event-tui-web-can-t-show-generic-tool-call-activity-in-the-transcript.md) | No tool_call SSE event — TUI/Web can't show generic tool-call activity in the transcript | feature | stefan |
| [DH-0107](../DH-0107-real-gemma-4-support-requires-a-new-provider-type-bedrock-mantle-openai-compatible-api.md) | Real Gemma 4 support requires a new provider type (Bedrock Mantle, OpenAI-compatible API) | feature | stefan |
| [DH-0112](../DH-0112-e2e-support-mock-provider-ts-never-updated-for-dh-0044-s-mandatory-streaming-real-turns-hang-past-agent-status.md) | e2e/support/mock-provider.ts never updated for DH-0044's mandatory streaming -- real turns hang past agent_status | bug | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0037](../DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md) | No log rotation/disk-growth caps, no structured final run-summary artifact, and no log-analysis tooling | feature | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary | feature | stefan |
| [DH-0061](../DH-0061-web-overnight-behavioral-test-agent-playwright-screenshot-verification-suite.md) | Web overnight behavioral test agent: Playwright screenshot verification suite | feature | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0114](../DH-0114-launch-sub-agents-as-real-claude-cli-subprocesses-in-the-target-worktree-not-in-process-agent-tool.md) | Launch sub-agents as real claude CLI subprocesses in the target worktree, not in-process Agent tool | done |
| [DH-0110](../DH-0110-urgent-web-ui-completely-broken-dh-0023-s-security-header-workaround-lost-bun-s-chunk-asset-routing.md) | URGENT: Web UI completely broken -- DH-0023's security-header workaround lost Bun's chunk-asset routing | done |
| [DH-0108](../DH-0108-comprehensive-markdown-rendering-test-suite-tui-web.md) | Comprehensive Markdown rendering test suite (TUI+Web) | done |
| [DH-0106](../DH-0106-gemma4-bedrock-default-model-hallucinates-tool-calls-instead-of-making-them.md) | dh init's scaffolded "gemma4" is actually Gemma 3 (wrong model), and hallucinates tool calls | done |
| [DH-0105](../DH-0105-unify-connection-state-and-status-vocabulary-across-tui-and-web.md) | Unify connection-state and status vocabulary across TUI and Web | done |
| [DH-0104](../DH-0104-unify-number-cost-elapsed-and-token-formatting-across-tui-web-and-cli.md) | Unify number, cost, elapsed, and token formatting across TUI, Web, and CLI | done |
| [DH-0103](../DH-0103-dh-help-styled-width-aware-visually-structured-output.md) | dh --help: styled, width-aware, visually structured output | done |
| [DH-0102](../DH-0102-dh-doctor-migrate-to-the-canonical-pending-spinner-and-check-cross-verdict-glyphs.md) | dh doctor: migrate to the canonical pending spinner and check/cross verdict glyphs | done |
| [DH-0101](../DH-0101-give-cli-command-output-a-real-visual-system-glyphs-hierarchy-color-liveness-beyond-dh-doctor.md) | Give CLI command output a real visual system (glyphs, hierarchy, color, liveness) beyond dh doctor | done |
| [DH-0100](../DH-0100-adopt-one-canonical-agent-status-color-glyph-word-model-across-tui-web-and-cli.md) | Adopt one canonical agent-status color/glyph/word model across TUI, Web, and CLI | done |
| [DH-0099](../DH-0099-dh-doctor-prints-nothing-until-all-models-are-checked-should-show-live-per-model-progress.md) | dh doctor prints nothing until all models are checked; should show live per-model progress | done |
| [DH-0098](../DH-0098-dh-init-output-is-one-giant-unwrapped-line-unreadable-in-a-terminal.md) | dh init output is one giant unwrapped line, unreadable in a terminal | done |
| [DH-0097](../DH-0097-cli-ts-never-wires-in-the-real-built-in-system-prompt-from-src-prompt-ships-a-placeholder-instead.md) | cli.ts never wires in the real built-in system prompt from src/prompt -- ships a placeholder instead | done |
| [DH-0096](../DH-0096-dh-init-s-scaffolded-config-should-be-a-richer-real-model-catalog-all-claude-tiers-bedrock-oss-models-local-url-env-var.md) | dh init's scaffolded config should be a richer, real model catalog (all Claude tiers, Bedrock OSS models, local URL env var) | done |
| [DH-0095](../DH-0095-tui-chrome-padding-looks-unchanged-despite-dh-0065-closing-as-fully-done.md) | TUI chrome/padding looks unchanged despite DH-0065 closing as fully done | done |
